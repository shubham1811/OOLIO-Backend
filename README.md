# OOLIO Backend - The Coffee House POS Server

> A lightweight Node.js & Express server designed to support POS frontend.

This backend provides a RESTful API for managing orders, handling data persistence with simple JSON files, and interfacing with a thermal printer for receipt printing.

---

## ✨ Features

- **RESTful API**: Simple and clear endpoints for managing orders.
- **JSON-based Data Storage**: Easily inspectable and manageable data storage for active orders and archived bills.
- **Thermal Printer Integration**: Directly connects to a USB thermal printer to print customer receipts using `escpos-usb`.
- **Order Archiving**: Automatically archives finalized orders for record-keeping.
- **CORS Enabled**: Pre-configured to accept requests from the frontend application.

## 🛠️ Tech Stack

- **Framework**: Express.js
- **Printer Communication**: node-escpos with `escpos-usb`
- **Live Reloading**: Nodemon for development

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v16.x or later recommended)
- npm or yarn
- A USB thermal receipt printer connected to your machine (for the printing feature).

## 🚀 Getting Started

Follow these steps to get the backend server up and running.

1.  **Navigate to the project directory**

    ```bash
    cd OOLIO-Backend
    ```

2.  **Install dependencies**

    ```bash
    npm install
    ```

3.  **Start the server**

    ```bash
    npm start
    ```

4.  **Verify the server is running**

    The server will start, and you should see a confirmation message in your console. It runs by default on `http://localhost:3000`.

    ```
    Server is running on port 3000
    ```

## ⚙️ How It Works

### Data Flow

The server uses two primary JSON files for data persistence:

- `orders.json`: Stores all active, open orders. When the frontend syncs data, this file is read from and written to.
- `billPrint.json`: Acts as an archive. When an order is closed and printed, its final details are appended to this file, and the order is removed from `orders.json`.

### Printer Setup

The server uses the `escpos` and `escpos-usb` libraries to communicate with a connected thermal printer.

1.  The application will attempt to find the first available USB thermal printer.
2.  Ensure your printer is supported by `node-escpos`. Most standard ESC/POS printers are compatible.
3.  On some operating systems (like Linux), you may need to set up udev rules to allow the Node.js process to access the USB device without requiring `sudo`.

## 📝 API Endpoints

The server exposes the following endpoints for the frontend to consume:

#### `GET /orders`

- **Description**: Retrieves all currently active orders.
- **Response**: A JSON array of order objects from `orders.json`.

#### `POST /orders`

- **Description**: Creates a new order for a seat that doesn't have an active order.
- **Request Body**: A JSON object representing the new order.
  ```json
  {
    "seatNo": 5,
    "items": [
      { "name": "Espresso", "size": "Small", "quantity": 1, "instructions": "" }
    ],
    "closed": false
  }
  ```
- **Action**: Adds the new order to `orders.json`.

#### `PUT /orders/:seatNo`

- **Description**: Updates an existing order for a specific seat. This is used for adding/removing items, changing quantities, or closing an order.
- **URL Params**: `seatNo` - The seat number of the order to update.
- **Request Body**: The complete, updated order object.
- **Action**: Finds the order by `seatNo` in `orders.json` and replaces it with the new data.

#### `POST /print-bill`

- **Description**: Finalizes an order, calculates the total price, archives it, and sends the formatted receipt to the thermal printer.
- **Request Body**: The final order object to be billed.
- **Action**:
  1.  Calculates the total price based on the items.
  2.  Appends the final bill to `billPrint.json`.
  3.  Removes the order from the active `orders.json`.
  4.  Formats and prints the receipt using `escpos-usb`.
