const express = require("express");
const app = express();
const port = 3000;
const fs = require("fs");
const path = require("path");
const cors = require("cors");
app.use(cors(), express.json());

const escpos = require("escpos");
// The usb transport layer is required for USB printers
escpos.USB = require("escpos-usb");

const productListingFilePath = "./Data/ProductListing/ProductListing.json";
const ordersDirectory = "./Data/Orders";
const ordersFilePath = path.join(ordersDirectory, "orders.json");
const billPrintFilePath = path.join(ordersDirectory, "billPrint.json");
const backupDataFilePath = path.join(ordersDirectory, "backupData.json");

// Ensure the orders directory exists
if (!fs.existsSync(ordersDirectory)) {
  fs.mkdirSync(ordersDirectory, { recursive: true });
}

// Helper to initialize JSON files if they don't exist
function initializeJsonFile(filePath, defaultContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2), "utf8");
  }
}

initializeJsonFile(ordersFilePath, {});
initializeJsonFile(billPrintFilePath, []);
initializeJsonFile(backupDataFilePath, []);

// Generic utility to read a JSON file
function readJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading from ${filePath}:`, error);
    // Return an appropriate empty state based on expected file content
    return filePath.endsWith("billPrint.json") ||
      filePath.endsWith("backupData.json")
      ? []
      : {};
  }
}

// Generic utility to write to a JSON file
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error);
  }
}

// Utility to append an item to a JSON file that contains an array
function appendToJsonArrayFile(filePath, item) {
  const data = readJsonFile(filePath);
  if (!Array.isArray(data)) {
    console.error(
      `Cannot append to ${filePath} because it does not contain a JSON array.`
    );
    return;
  }
  data.push(item);
  writeJsonFile(filePath, data);
}

// GET endpoint for product listing items (existing)
app.get("/ProductListingItems", (req, res) => {
  const items = readJsonFile(productListingFilePath);
  res.json(items);
});

// GET endpoint for all orders
app.get("/orders", (req, res) => {
  const orders = readJsonFile(ordersFilePath);
  res.json(orders);
});

// GET endpoint for all printed bills
app.get("/printed-bills", (req, res) => {
  const printedBills = readJsonFile(billPrintFilePath);
  res.json(printedBills);
});

// POST endpoint to create an order for a new seat.
// The frontend is expected to use PUT for updating existing seats.
app.post("/orders", (req, res) => {
  const newOrder = req.body;
  const seatNo = newOrder.seatNo;

  if (!seatNo || !newOrder.items) {
    return res.status(400).json({
      message:
        "Request body must be a valid order object with seatNo and items.",
    });
  }

  const currentOrders = readJsonFile(ordersFilePath);

  if (currentOrders[seatNo]) {
    return res.status(409).json({
      message: `Order for seat ${seatNo} already exists. Use PUT to update.`,
    });
  }

  currentOrders[seatNo] = newOrder;
  writeJsonFile(ordersFilePath, currentOrders);
  res.status(201).json(newOrder);
});

// PUT endpoint to create or replace a seat's entire order object
app.put("/orders/:seatNo", (req, res) => {
  const seatNo = req.params.seatNo;
  const orderData = req.body; // Expects a full order object

  // The body should be the full order object from Dexie, which includes an 'items' array
  if (!orderData || typeof orderData !== "object" || !orderData.items) {
    return res.status(400).json({
      message:
        "Request body must be a valid order object with an 'items' array.",
    });
  }

  const currentOrders = readJsonFile(ordersFilePath);

  if (orderData.closed === true) {
    // Order is being closed
    const orderToClose = currentOrders[seatNo];

    if (orderToClose) {
      // The client sends the most up-to-date order object, including item statuses.
      // We'll use that as the base and enrich it with server-side price calculations
      // to prevent client-side price tampering.
      const finalOrderState = { ...orderToClose, ...orderData };

      // 1. Load product data for price calculation
      const products = readJsonFile(productListingFilePath);
      const productMap = new Map(products.map((p) => [p.pk_key, p]));

      // 2. Calculate prices and totals using the final order state's items
      let grandTotal = 0;
      const itemsWithPrices = finalOrderState.items.map((item) => {
        const product = productMap.get(item.productId);
        if (!product) {
          return {
            ...item,
            unitPrice: 0,
            itemTotal: 0,
            productName: "Unknown Product",
          };
        }

        const basePrice = parseFloat(product.ProductPrice.replace("$", ""));
        const unitPrice = item.size === "Small" ? basePrice : basePrice * 2;
        const itemTotal = unitPrice * item.quantity;
        grandTotal += itemTotal;

        return {
          ...item,
          productName: product.ProductName,
          unitPrice: unitPrice,
          itemTotal: itemTotal,
        };
      });

      // 3. Construct the final bill object
      const billData = {
        ...finalOrderState,
        items: itemsWithPrices,
        grandTotal: grandTotal,
        closedAt: new Date().toISOString(),
      };

      // 1. Append to billPrint.json (FIFO)
      appendToJsonArrayFile(billPrintFilePath, billData);

      // 2. Append to backupData.json
      appendToJsonArrayFile(backupDataFilePath, billData);

      // 3. Remove from active orders.json
      delete currentOrders[seatNo];
      writeJsonFile(ordersFilePath, currentOrders);

      console.log(`Order for seat ${seatNo} closed and archived with pricing.`);
      res
        .status(200)
        .json({ message: `Order for seat ${seatNo} closed successfully.` });
    } else {
      // This can happen if a sync retry occurs after the order is already closed.
      console.log(
        `Order for seat ${seatNo} not found in active orders. It might be already closed.`
      );
      res.status(200).json({
        message: `Order for seat ${seatNo} was already closed or not found.`,
      });
    }
  } else {
    // Order is being created or updated
    currentOrders[seatNo] = orderData;
    writeJsonFile(ordersFilePath, currentOrders);
    console.log(`Order for seat ${seatNo} created/updated.`);
    res.status(200).json(currentOrders[seatNo]);
  }
});

// POST endpoint to handle printing a bill
app.post("/print-bill", (req, res) => {
  const bill = req.body;

  if (!bill || !bill.seatNo || !bill.items || !bill.grandTotal) {
    return res.status(400).json({ message: "Invalid bill data provided." });
  }

  try {
    // Find the USB device. If you have multiple, you might need to specify
    // the vendor and product ID. e.g., new escpos.USB(0x04b8, 0x0202)
    const devices = escpos.USB.findPrinter();
    const device = devices.length > 0 ? devices[0] : null;

    if (!device) {
      // This is a simulation for when no printer is connected.
      console.warn(
        "No USB thermal printer found. Simulating print to console."
      );

      // The receipt generation logic is moved from the frontend to here.
      let receipt = "";
      receipt += "The Coffee House\n";
      receipt += "================================\n";
      receipt += `Seat: ${bill.seatNo}\n`;
      receipt += `Date: ${new Date(bill.closedAt).toLocaleString()}\n`;
      receipt += "--------------------------------\n";
      receipt += "Item(s)              Qty   Total\n";
      receipt += "--------------------------------\n";

      bill.items.forEach((item) => {
        const name = item.productName.padEnd(20).substring(0, 20);
        const qty = item.quantity.toString().padStart(3);
        const price = `$${item.itemTotal.toFixed(2)}`.padStart(7);
        receipt += `${name} ${qty} ${price}\n`;
        if (item.size !== "Small") {
          receipt += `  - Size: ${item.size}\n`;
        }
        if (item.instructions) {
          receipt += `  - Notes: ${item.instructions}\n`;
        }
      });

      receipt += "--------------------------------\n";
      receipt += `Grand Total: ${("$" + bill.grandTotal.toFixed(2)).padStart(
        18
      )}\n`;
      receipt += "================================\n";
      receipt += "Thank you for your visit!\n\n\n";

      console.log("--- SIMULATED PRINTER OUTPUT ---");
      console.log(receipt);

      return res.status(200).json({
        message:
          "Printer not found. Bill content logged to server console for simulation.",
      });
    }

    const printer = new escpos.Printer(device);

    device.open((error) => {
      if (error) {
        console.error("Error opening printer device:", error);
        return res
          .status(500)
          .json({ message: "Could not connect to the printer." });
      }

      // Use the printer object to send commands
      printer
        .font("a")
        .align("ct")
        .style("bu")
        .size(1, 1)
        .text("The Coffee House")
        .text(`Seat: ${bill.seatNo}`)
        .text(new Date(bill.closedAt).toLocaleString())
        .feed()
        .style("normal")
        .align("lt")
        .text("--------------------------------");

      bill.items.forEach((item) => {
        printer.table([
          `${item.productName}${
            item.size !== "Small" ? ` (${item.size})` : ""
          }`,
          item.quantity,
          `$${item.itemTotal.toFixed(2)}`,
        ]);
        if (item.instructions) {
          printer.text(`  Notes: ${item.instructions}`);
        }
      });

      printer
        .text("--------------------------------")
        .feed()
        .align("rt")
        .style("b")
        .text(`Grand Total: $${bill.grandTotal.toFixed(2)}`)
        .feed(2)
        .align("ct")
        .text("Thank you for your visit!")
        .cut()
        .close();

      res.status(200).json({ message: "Bill sent to printer successfully." });
    });
  } catch (e) {
    console.error("Printing error:", e);
    return res.status(500).json({
      message: "An error occurred during printing. Is a printer connected?",
    });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
