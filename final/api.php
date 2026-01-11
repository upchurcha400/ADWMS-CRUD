<?php
// SESSION CONFIG - MUST BE FIRST
session_set_cookie_params([
    'lifetime' => 86400,
    'path' => '/',
    'secure' => false,
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_start();

header('Content-Type: application/json');
error_reporting(0);

try {
    if (!is_dir('data')) mkdir('data', 0777, true);
    
    $db = new PDO("sqlite:data/system.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT,
        assistant_email TEXT,
        assigned_roles TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database connection failed']);
    error_log('DB Connection Error: ' .$e->getMessage());
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? $_GET['action'] ?? '';

// Check session
if ($action === 'check_session') {
    if (isset($_SESSION['user_id'])) {
        echo json_encode(['authenticated' => true, 'username' => $_SESSION['username'], 'role' => $_SESSION['role']]);
    } else {
        echo json_encode(['authenticated' => false]);
    }
    exit;
}

// Login
if ($action === 'login') {
    $username = $input['username'] ?? '';
    $password = $input['password'] ?? '';
    
    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($user && password_verify($password, $user['password'])) {
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['role'] = $user['role'];
        echo json_encode(['success' => true, 'username' => $user['username'], 'role' => $user['role']]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid credentials']);
    }
    exit;
}

// Logout
if ($action === 'logout') {
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

// Warranty tracking update
if ($action === 'update_warranty_tracking') {
    $approvalNum = trim($data['approval_number']);
    $trackingNum = trim($data['tracking_number']);
    
    if (empty($approvalNum) || empty($trackingNum)) {
        echo json_encode(['success' => false, 'error' => 'Both fields are required']);
        exit;
    }
    
    try {
        $stmt = $pdo->prepare("UPDATE warranty_claims SET return_tracking = ?, updated_at = NOW() WHERE approval_number = ?");
        $stmt->execute([$trackingNum, $approvalNum]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Approval number not found']);
        }
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'Database error: ' . $e->getMessage()]);
    }
    exit;
}

// Import RMA CSV
if ($action === 'import_rma_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    $mergeData = [];
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        $tracking = $record['TrackingNumber'] ?? '';
        if (empty($tracking)) continue;
        
        if (!isset($mergeData[$tracking])) {
            $mergeData[$tracking] = $record;
        } else {
            $mergeData[$tracking] = array_merge($mergeData[$tracking], $record);
        }
    }
    
    foreach ($mergeData as $record) {
        $stmt = $pdo->prepare("INSERT INTO rma_data (tracking_number, order_number, rma_number, name, phone, carrier_fee, raw_data) 
                               VALUES (?, ?, ?, ?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE order_number=VALUES(order_number), rma_number=VALUES(rma_number), 
                               name=VALUES(name), phone=VALUES(phone), carrier_fee=VALUES(carrier_fee), raw_data=VALUES(raw_data)");
        $stmt->execute([
            $record['TrackingNumber'] ?? '',
            $record['OrderNumber'] ?? '',
            $record['RMANumber'] ?? '',
            $record['Name'] ?? '',
            $record['Phone'] ?? '',
            $record['CarrierFee'] ?? '',
            json_encode($record)
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Refund CSV
if ($action === 'import_refund_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO refund_tracker (tracking_number, email_address, adn_number, cin7_number, rma_number, order_number, 
                               customer_name, sku1, sku2, sku3, sku4, sku5, qty1, qty2, qty3, qty4, qty5, refund_amount, shipping_loss, 
                               total_loss, exchange_or_refund, charged_in, has_been_refunded, reason_for_transaction, transaction_notes, describe_damage) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                               ON DUPLICATE KEY UPDATE email_address=VALUES(email_address), adn_number=VALUES(adn_number), 
                               cin7_number=VALUES(cin7_number), rma_number=VALUES(rma_number), order_number=VALUES(order_number)");
        $stmt->execute([
            $record['tracking_number'] ?? '',
            $record['email_address'] ?? '',
            $record['adn_number'] ?? '',
            $record['cin7_number'] ?? '',
            $record['rma_number'] ?? '',
            $record['order_number'] ?? '',
            $record['customer_name'] ?? '',
            $record['sku1'] ?? '', $record['sku2'] ?? '', $record['sku3'] ?? '', $record['sku4'] ?? '', $record['sku5'] ?? '',
            $record['qty1'] ?? '', $record['qty2'] ?? '', $record['qty3'] ?? '', $record['qty4'] ?? '', $record['qty5'] ?? '',
            $record['refund_amount'] ?? '',
            $record['shipping_loss'] ?? '',
            $record['total_loss'] ?? '',
            $record['exchange_or_refund'] ?? '',
            $record['charged_in'] ?? '',
            $record['has_been_refunded'] ?? '',
            $record['reason_for_transaction'] ?? '',
            $record['transaction_notes'] ?? '',
            $record['describe_damage'] ?? ''
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Shipments CSV
if ($action === 'import_shipments_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO shipstation_shipments (order_number, tracking_number, item_sku, item_name, item_quantity, carrier_fee, raw_data) 
                               VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $record['Order #'] ?? '',
            $record['Tracking #'] ?? '',
            $record['Item SKU'] ?? '',
            $record['Item Name'] ?? '',
            $record['Item Quantity'] ?? '',
            $record['Carrier Fee'] ?? '',
            json_encode($record)
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Inventory CSV
if ($action === 'import_inventory_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $sku = $record['Variant SKU'] ?? '';
        if (empty($sku)) continue;
        
        $stmt = $pdo->prepare("INSERT INTO shopify_inventory (sku, price, barcode, title, weight_grams, image_url) 
                               VALUES (?, ?, ?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE price=VALUES(price), barcode=VALUES(barcode), 
                               title=VALUES(title), weight_grams=VALUES(weight_grams), image_url=VALUES(image_url)");
        $stmt->execute([
            $sku,
            $record['Variant Price'] ?? '',
            $record['Variant Barcode'] ?? '',
            $record['Title'] ?? '',
            $record['Variant Grams'] ?? '',
            $record['Image Src'] ?? ''
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Cin7 CSV
if ($action === 'import_cin7_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO cin7_data (customer_ref, order_number, invoice_number, sku, product, qty, price, raw_data) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $record['Customer ref'] ?? '',
            $record['Order #'] ?? '',
            $record['Invoice #'] ?? '',
            $record['SKU'] ?? '',
            $record['Product'] ?? '',
            $record['Qty'] ?? '',
            $record['Price'] ?? '',
            json_encode($record)
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Labels CSV
if ($action === 'import_labels_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO scan_labels (qr_code, label_text, count_as_item, damaged_slip) 
                               VALUES (?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE label_text=VALUES(label_text), 
                               count_as_item=VALUES(count_as_item), damaged_slip=VALUES(damaged_slip)");
        $stmt->execute([
            $record['QR CODE'] ?? '',
            $record['LABEL TEXT'] ?? '',
            $record['COUNT AS ITEM'] ?? 'N',
            $record['DAMAGED SLIP'] ?? 'N'
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}
// Import RMA CSV
if ($action === 'import_rma_csv') {
    $csvData= $data['csv_data'];
    $lines= explode("\n", $csvData);
    $headers= str_getcsv(array_shift($lines));
    $count= 0;
    
    $mergeData = [];
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        $tracking = $record['TrackingNumber'] ?? '';
        if (empty($tracking)) continue;
        
        if (!isset($mergeData[$tracking])) {
            $mergeData[$tracking] = $record;
        } else {
            $mergeData[$tracking] = array_merge($mergeData[$tracking], $record);
        }
    }
    
    foreach ($mergeData as $record) {
        $stmt = $pdo->prepare("INSERT INTO rma_data (tracking_number, order_number, rma_number, name, phone, carrier_fee, raw_data) 
                               VALUES (?, ?, ?, ?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE order_number=VALUES(order_number), rma_number=VALUES(rma_number), 
                               name=VALUES(name), phone=VALUES(phone), carrier_fee=VALUES(carrier_fee), raw_data=VALUES(raw_data)");
        $stmt->execute([
            $record['TrackingNumber'] ?? '',
            $record['OrderNumber'] ?? '',
            $record['RMANumber'] ?? '',
            $record['Name'] ?? '',
            $record['Phone'] ?? '',
            $record['CarrierFee'] ?? '',
            json_encode($record)
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Refund CSV
if ($action === 'import_refund_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO refund_tracker (tracking_number, email_address, adn_number, cin7_number, rma_number, order_number, 
                               customer_name, sku1, sku2, sku3, sku4, sku5, qty1, qty2, qty3, qty4, qty5, refund_amount, shipping_loss, 
                               total_loss, exchange_or_refund, charged_in, has_been_refunded, reason_for_transaction, transaction_notes, describe_damage) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                               ON DUPLICATE KEY UPDATE email_address=VALUES(email_address), adn_number=VALUES(adn_number), 
                               cin7_number=VALUES(cin7_number), rma_number=VALUES(rma_number), order_number=VALUES(order_number)");
        $stmt->execute([
            $record['tracking_number'] ?? '',
            $record['email_address'] ?? '',
            $record['adn_number'] ?? '',
            $record['cin7_number'] ?? '',
            $record['rma_number'] ?? '',
            $record['order_number'] ?? '',
            $record['customer_name'] ?? '',
            $record['sku1'] ?? '', $record['sku2'] ?? '', $record['sku3'] ?? '', $record['sku4'] ?? '', $record['sku5'] ?? '',
            $record['qty1'] ?? '', $record['qty2'] ?? '', $record['qty3'] ?? '', $record['qty4'] ?? '', $record['qty5'] ?? '',
            $record['refund_amount'] ?? '',
            $record['shipping_loss'] ?? '',
            $record['total_loss'] ?? '',
            $record['exchange_or_refund'] ?? '',
            $record['charged_in'] ?? '',
            $record['has_been_refunded'] ?? '',
            $record['reason_for_transaction'] ?? '',
            $record['transaction_notes'] ?? '',
            $record['describe_damage'] ?? ''
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Shipments CSV
if ($action === 'import_shipments_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO shipstation_shipments (order_number, tracking_number, item_sku, item_name, item_quantity, carrier_fee, raw_data) 
                               VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $record['Order #'] ?? '',
            $record['Tracking #'] ?? '',
            $record['Item SKU'] ?? '',
            $record['Item Name'] ?? '',
            $record['Item Quantity'] ?? '',
            $record['Carrier Fee'] ?? '',
            json_encode($record)
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Inventory CSV
if ($action === 'import_inventory_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $sku = $record['Variant SKU'] ?? '';
        if (empty($sku)) continue;
        
        $stmt = $pdo->prepare("INSERT INTO shopify_inventory (sku, price, barcode, title, weight_grams, image_url) 
                               VALUES (?, ?, ?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE price=VALUES(price), barcode=VALUES(barcode), 
                               title=VALUES(title), weight_grams=VALUES(weight_grams), image_url=VALUES(image_url)");
        $stmt->execute([
            $sku,
            $record['Variant Price'] ?? '',
            $record['Variant Barcode'] ?? '',
            $record['Title'] ?? '',
            $record['Variant Grams'] ?? '',
            $record['Image Src'] ?? ''
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Cin7 CSV
if ($action === 'import_cin7_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO cin7_data (customer_ref, order_number, invoice_number, sku, product, qty, price, raw_data) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $record['Customer ref'] ?? '',
            $record['Order #'] ?? '',
            $record['Invoice #'] ?? '',
            $record['SKU'] ?? '',
            $record['Product'] ?? '',
            $record['Qty'] ?? '',
            $record['Price'] ?? '',
            json_encode($record)
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}

// Import Labels CSV
if ($action === 'import_labels_csv') {
    $csvData = $data['csv_data'];
    $lines = explode("\n", $csvData);
    $headers = str_getcsv(array_shift($lines));
    $count = 0;
    
    foreach ($lines as $line) {
        if (empty(trim($line))) continue;
        $row = str_getcsv($line);
        $record = array_combine($headers, $row);
        
        $stmt = $pdo->prepare("INSERT INTO scan_labels (qr_code, label_text, count_as_item, damaged_slip) 
                               VALUES (?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE label_text=VALUES(label_text), 
                               count_as_item=VALUES(count_as_item), damaged_slip=VALUES(damaged_slip)");
        $stmt->execute([
            $record['QR CODE'] ?? '',
            $record['LABEL TEXT'] ?? '',
            $record['COUNT AS ITEM'] ?? 'N',
            $record['DAMAGED SLIP'] ?? 'N'
        ]);
        $count++;
    }
    
    echo json_encode(['success' => true, 'count' => $count]);
    exit;
}
echo json_encode(['success' => false, 'error' => 'Unknown action']);
?>