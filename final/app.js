// American Darling Receiving System - Main Application JavaScript

const API_URL = 'api.php';
let currentUser = null;
let sessionShipmentCount = 0;
let awaitingAcknowledgment = false;
let pendingTracking = null;

// SKUVault credentials
const SKUVAULT_TENANT = '7qj2AMaih7aeQEF6Fxo5umX2CxhBj8Xyoap1wMwHT28=';
const SKUVAULT_USER = '+MBweDSXeNY798DLxyZetU9yeR2KFrwYqsr4diaVuMA=';

// =============================================================================
// AUTHENTICATION & INITIALIZATION
// =============================================================================

// Check authentication on load
(async () => {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'check_session'})
        });
        
        const data = await response.json();
        
        if (!data.authenticated) {
            window.location.href = 'login.html';
            return;
        }
        
        currentUser = data.user;
        document.getElementById('userName').textContent = `${currentUser.first_name} ${currentUser.last_name}`;
        document.getElementById('userRole').textContent = `Role: ${currentUser.role}`;
        
        // Show user management for admins
        if (currentUser.role === 'admin') {
            document.getElementById('userManagementBtn').style.display = 'block';
        }
        
        // Hide import section for non-admin/office users
        if (!['admin', 'office'].includes(currentUser.role)) {
            document.getElementById('importSection').style.display = 'none';
        }
        
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = 'login.html';
    }
})();

// Logout function
async function logout() {
    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'logout'})
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    window.location.href = 'login.html';
}

// =============================================================================
// SCREEN NAVIGATION
// =============================================================================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    if (screenId === 'receiveShipments') {
        document.getElementById('receiveInput').focus();
    } else if (screenId === 'processRMA') {
        document.getElementById('auditInput').focus();
    } else if (screenId === 'notifications') {
        loadNotifications();
    } else if (screenId === 'finalizeRMA') {
        loadPendingAudits();
    } else if (screenId === 'userManagement') {
        loadUsers();
    }
}

// =============================================================================
// IMPORT RMA DATA
// =============================================================================

async function importRMA() {
    const file = document.getElementById('rmaFile').files[0];
    if (!file) {
        alert('Please select an RMA CSV file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csv = e.target.result;
        const lines = csv.split('\n');
        
        if (lines.length < 2) {
            alert('CSV file appears empty or invalid');
            return;
        }
        
        // Detect delimiter
        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : ',';
        const headers = firstLine.split(delimiter).map(h => h.trim().replace(/\r/g, ''));
        
        const rmas = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(delimiter).map(v => v.trim().replace(/\r/g, ''));
            const rma = {};
            
            headers.forEach((header, idx) => {
                rma[header] = values[idx] || '';
            });
            
            if (rma.TrackingNumber) {
                rmas.push(rma);
            }
        }
        
        if (rmas.length === 0) {
            alert('No valid RMA records found in file');
            return;
        }
        
        // Send to API
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'import_rmas',
                    rmas: rmas
                })
            });
            
            const data = await response.json();
            
            if (data.error) {
                alert('Error: ' + data.error);
            } else {
                alert(`Successfully imported ${data.imported} RMA records!`);
            }
        } catch (error) {
            alert('Error importing RMAs: ' + error.message);
            console.error('Import error:', error);
        }
    };
    
    reader.readAsText(file);
}

// =============================================================================
// RECEIVE SHIPMENTS
// =============================================================================

document.getElementById('receiveInput')?.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const tracking = e.target.value.trim();
        e.target.value = '';
        
        if (!tracking) return;
        
        // Check if awaiting acknowledgment
        if (awaitingAcknowledgment && tracking === pendingTracking) {
            document.getElementById('alertScreen').classList.remove('active');
            awaitingAcknowledgment = false;
            pendingTracking = null;
            
            // Acknowledge notification
            await fetch(API_URL, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'acknowledge_notification',
                    tracking_number: tracking
                })
            });
            return;
        }
        
        // Check for notification
        const notifResponse = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'get_notification',
                tracking_number: tracking
            })
        });
        
        const notifData = await notifResponse.json();
        
        if (notifData.notification) {
            const n = notifData.notification;
            showAlert(`Package for ${n.notify_person} has arrived!\n\nShipment Type: ${n.shipment_type}\nShipper: ${n.shipper_name}`);
            awaitingAcknowledgment = true;
            pendingTracking = tracking;
            return;
        }
        
        // Record shipment
        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'record_shipment',
                    tracking_number: tracking
                })
            });
            
            sessionShipmentCount++;
            document.getElementById('sessionCount').textContent = sessionShipmentCount;
            
        } catch (error) {
            console.error('Error recording shipment:', error);
        }
    }
});

function showAlert(message) {
    document.getElementById('alertMessage').textContent = message;
    document.getElementById('alertScreen').classList.add('active');
    
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE=');
    audio.play().catch(() => {});
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

async function loadNotifications() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'get_notifications'})
        });
        
        const data = await response.json();
        const notifications = data.notifications || [];
        
        const listEl = document.getElementById('notificationList');
        
        if (notifications.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: #666;">No notification requests</p>';
            return;
        }
        
        listEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Tracking</th>
                        <th>Notify</th>
                        <th>Shipper</th>
                        <th>Type</th>
                        <th>Status</th>
                        ${['admin', 'office', 'receiving'].includes(currentUser?.role) ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${notifications.map(n => `
                        <tr>
                            <td>${n.tracking_number}</td>
                            <td>${n.notify_person}</td>
                            <td>${n.shipper_name}</td>
                            <td>${n.shipment_type}</td>
                            <td>${n.acknowledged ? '<span style="color: green;">✓ Received</span>' : '<span style="color: orange;">Pending</span>'}</td>
                            ${['admin', 'office', 'receiving'].includes(currentUser?.role) ? `
                                <td>
                                    <button class="btn btn-danger" onclick="deleteNotification('${n.tracking_number}')" style="padding: 5px 10px; font-size: 0.9em;">Delete</button>
                                </td>
                            ` : ''}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

async function deleteNotification(tracking) {
    if (!confirm('Delete this notification request?')) return;
    
    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'delete_notification',
                tracking_number: tracking
            })
        });
        
        loadNotifications();
    } catch (error) {
        console.error('Error deleting notification:', error);
    }
}

async function submitNotification(e) {
    e.preventDefault();
    
    const notification = {
        tracking_number: document.getElementById('notifTracking').value.trim(),
        notify_person: document.getElementById('notifPerson').value.trim(),
        shipper_name: document.getElementById('notifShipper').value.trim(),
        shipment_type: document.getElementById('notifType').value,
        notes: document.getElementById('notifNotes').value.trim()
    };
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'add_notification',
                notification: notification
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Error: ' + data.error);
        } else {
            alert('Notification added successfully!');
            e.target.reset();
            showScreen('notifications');
        }
    } catch (error) {
        alert('Error adding notification: ' + error.message);
        console.error('Submit error:', error);
    }
}

// =============================================================================
// USER MANAGEMENT
// =============================================================================

async function loadUsers() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'get_users'})
        });
        
        const data = await response.json();
        const users = data.users || [];
        
        const listEl = document.getElementById('userList');
        
        if (users.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: #666;">No users found</p>';
            return;
        }
        
        listEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => `
                        <tr>
                            <td>${u.username}</td>
                            <td>${u.first_name} ${u.last_name}</td>
                            <td>${u.role}</td>
                            <td>
                                <button class="btn" onclick='editUser(${JSON.stringify(u)})' style="padding: 5px 10px; font-size: 0.9em;">Edit</button>
                                <button class="btn btn-danger" onclick="deleteUser(${u.id})" style="padding: 5px 10px; font-size: 0.9em;">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function showAddUserModal() {
    document.getElementById('userModalTitle').textContent = 'Add User';
    document.getElementById('editUserId').value = '';
    document.getElementById('userUsername').value = '';
    document.getElementById('userPassword').value = '';
    document.getElementById('userFirstName').value = '';
    document.getElementById('userLastName').value = '';
    document.getElementById('userRole').value = 'receiving';
    document.getElementById('userModal').classList.add('active');
}

function editUser(user) {
    document.getElementById('userModalTitle').textContent = 'Edit User';
    document.getElementById('editUserId').value = user.id;
    document.getElementById('userUsername').value = user.username;
    document.getElementById('userPassword').value = '';
    document.getElementById('userFirstName').value = user.first_name;
    document.getElementById('userLastName').value = user.last_name;
    document.getElementById('userRole').value = user.role;
    document.getElementById('userModal').classList.add('active');
}

function closeUserModal() {
    document.getElementById('userModal').classList.remove('active');
}

async function submitUser(e) {
    e.preventDefault();
    
    const userId = document.getElementById('editUserId').value;
    const user = {
        id: userId || undefined,
        username: document.getElementById('userUsername').value.trim(),
        password: document.getElementById('userPassword').value,
        first_name: document.getElementById('userFirstName').value.trim(),
        last_name: document.getElementById('userLastName').value.trim(),
        role: document.getElementById('userRole').value
    };
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: userId ? 'update_user' : 'add_user',
                user: user
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Error: ' + data.error);
        } else {
            alert(userId ? 'User updated successfully!' : 'User added successfully!');
            closeUserModal();
            loadUsers();
        }
    } catch (error) {
        alert('Error saving user: ' + error.message);
        console.error('Submit error:', error);
    }
}

async function deleteUser(userId) {
    if (!confirm('Delete this user?')) return;
    
    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'delete_user',
                user_id: userId
            })
        });
        
        loadUsers();
    } catch (error) {
        console.error('Error deleting user:', error);
    }
}

// =============================================================================
// PROCESS RMA AUDIT
// =============================================================================

let currentAuditSession = [];
let currentBox = null;
let lastScannedItem = null;
let shiftPressed = false;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftPressed = true;
});
document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftPressed = false;
});

document.getElementById('auditInput')?.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const scan = e.target.value.trim().toUpperCase();
        e.target.value = '';
        
        if (!scan) return;
        
        await processScan(scan);
    }
});

async function processScan(scan) {
    // Check if label (starts with #)
    if (scan.startsWith('#')) {
        await processLabel(scan);
        return;
    }
    
    // Check if SKU (starts with AD, SW, NM, OH, KB)
    const skuPrefixes = ['AD', 'SW', 'NM', 'OH', 'KB'];
    const isSKU = skuPrefixes.some(prefix => scan.startsWith(prefix));
    
    if (isSKU) {
        await processSKU(scan);
        return;
    }
    
    // Check if tracking (13-24 chars)
    if (scan.length >= 13 && scan.length <= 24) {
        const rmaResponse = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'get_rma',
                tracking_number: scan
            })
        });
        
        const rmaData = await rmaResponse.json();
        
        if (rmaData.rma) {
            startNewBox(rmaData.rma, false);
        } else {
            startNewBox({TrackingNumber: scan}, true);
        }
        return;
    }
    
    // Default to SKU
    await processSKU(scan);
}

function startNewBox(rma, unlisted) {
    const date = new Date();
    const boxNumber = `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${currentAuditSession.length + 1}`;
    
    currentBox = {
        boxNumber: boxNumber,
        tracking: rma.TrackingNumber || rma.tracking_number,
        orderNumber: rma.OrderNum || rma.order_number || 'UNLISTED',
        rmaNumber: rma.RMANumber || rma.rma_number || 'UNLISTED',
        customerName: rma.Name || rma.customer_name || 'Unlisted Customer',
        phone: rma.Phone || rma.phone || '',
        carrierFee: parseFloat(rma.CarrierFee || rma.carrier_fee || 0),
        unlisted: unlisted,
        items: [],
        boxLabels: []
    };
    
    currentAuditSession.push(currentBox);
    renderAuditBoxes();
    
    console.log('Started box:', boxNumber, unlisted ? '(UNLISTED)' : '');
}

async function processLabel(label) {
    if (!currentBox) {
        alert('Scan tracking number first to start a box!');
        return;
    }
    
    // Get label details
    const labelResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            action: 'get_label',
            qr_code: label
        })
    });
    
    const labelData = await labelResponse.json();
    const labelText = labelData.label?.label_text || label;
    
    // Shift = remove label
    if (shiftPressed) {
        if (lastScannedItem) {
            lastScannedItem.labels = lastScannedItem.labels.filter(l => l !== labelText);
        }
        if (currentBox.boxLabels) {
            currentBox.boxLabels = currentBox.boxLabels.filter(l => l !== labelText);
        }
        renderAuditBoxes();
        return;
    }
    
    // Check if label counts as item (duplicate scan)
    if (labelData.label && labelData.label.count_as_item === 'Y' && 
        lastScannedItem?.labels?.includes(labelText)) {
        const newItem = {
            sku: 'UNKNOWN - NEEDS SKU',
            price: 0,
            labels: [labelText],
            nio: false,
            needsVerification: true
        };
        currentBox.items.push(newItem);
        lastScannedItem = newItem;
    } else {
        // Add to last item or box
        if (lastScannedItem) {
            if (!lastScannedItem.labels) lastScannedItem.labels = [];
            lastScannedItem.labels.push(labelText);
        } else {
            currentBox.boxLabels.push(labelText);
        }
    }
    
    renderAuditBoxes();
}

async function processSKU(sku) {
    if (!currentBox) {
        alert('Scan tracking number first to start a box!');
        return;
    }
    
    let price = 0;
    let needsVerification = false;
    let nio = false;
    
    // Try to get price from SKUVault if we have an order
    if (currentBox.orderNumber && currentBox.orderNumber !== 'UNLISTED') {
        const orderDetails = await getOrderFromSKUVault(currentBox.orderNumber, sku);
        if (orderDetails) {
            price = orderDetails.price;
        } else {
            nio = true;
        }
    } else {
        // Unlisted - get from product catalog
        const productDetails = await getProductPriceFromSKUVault(sku);
        if (productDetails) {
            price = productDetails.price;
            needsVerification = true;
        } else {
            nio = true;
        }
    }
    
    if (nio) {
        // Flash red and beep
        document.body.style.background = 'red';
        setTimeout(() => {
            document.body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }, 500);
        
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE=');
        audio.play().catch(() => {});
    }
    
    const item = {
        sku: sku,
        price: price,
        labels: [],
        nio: nio,
        needsVerification: needsVerification
    };
    
    currentBox.items.push(item);
    lastScannedItem = item;
    renderAuditBoxes();
}

async function getOrderFromSKUVault(orderNumber, sku) {
    try {
        const response = await fetch('https://app.skuvault.com/api/sales/getSales', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                TenantToken: SKUVAULT_TENANT,
                UserToken: SKUVAULT_USER,
                PageNumber: 0,
                PageSize: 100
            })
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        const sale = data.Sales?.find(s => s.OrderNumber?.endsWith(orderNumber));
        
        if (!sale) return null;
        
        const lineItem = sale.LineItems?.find(item => 
            item.Sku?.toUpperCase() === sku || 
            item.ProductIdentifiers?.some(id => id.Identifier?.toUpperCase() === sku)
        );
        
        return lineItem ? { price: lineItem.UnitPrice || 0 } : null;
        
    } catch (error) {
        console.error('SKUVault error:', error);
        return null;
    }
}

async function getProductPriceFromSKUVault(sku) {
    try {
        const response = await fetch('https://app.skuvault.com/api/products/getProducts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                TenantToken: SKUVAULT_TENANT,
                UserToken: SKUVAULT_USER,
                ProductSKUs: [sku]
            })
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        const product = data.Products?.[0];
        
        return product ? { price: product.RetailPrice || product.Cost || 0 } : null;
        
    } catch (error) {
        console.error('SKUVault error:', error);
        return null;
    }
}

function renderAuditBoxes() {
    const container = document.getElementById('auditBoxes');
    if (!container) return;
    
    container.innerHTML = currentAuditSession.map(box => {
        const totalPrice = box.items.reduce((sum, item) => sum + (item.price || 0), 0);
        const unlistedBadge = box.unlisted ? '<span style="background: orange; color: white; padding: 5px 10px; border-radius: 3px; margin-left: 10px;">UNLISTED</span>' : '';
        
        return `
            <div style="border: 2px solid ${box.unlisted ? 'orange' : '#667eea'}; border-radius: 5px; padding: 20px; margin-bottom: 20px; background: #f8f9fa;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 1.3em; font-weight: bold;">
                    <span>Box ${box.boxNumber}${unlistedBadge}</span>
                    <span>Tracking: ${box.tracking}</span>
                    <span>RMA: ${box.rmaNumber}</span>
                </div>
                ${box.boxLabels.length ? `
                    <div style="margin-bottom: 10px;">
                        <strong>Box Labels:</strong> 
                        ${box.boxLabels.map(l => `<span style="background: #ffc107; padding: 3px 8px; border-radius: 3px; margin-right: 5px;">${l}</span>`).join('')}
                    </div>
                ` : ''}
                <div>
                    ${box.items.map((item, idx) => `
                        <div style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #ddd; gap: 10px;">
                            <span>${idx + 1}.</span>
                            <span style="flex: 2; font-weight: bold;">
                                ${item.sku}
                                ${item.nio ? '<span style="color: red; font-weight: bold;"> NIO</span>' : ''}
                                ${item.needsVerification ? '<span style="background: #ffc107; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; margin-left: 5px;">⚠ VERIFY</span>' : ''}
                            </span>
                            <span style="flex: 2; display: flex; gap: 5px; flex-wrap: wrap;">
                                ${item.labels?.map(l => `<span style="background: #ffc107; padding: 3px 8px; border-radius: 3px; font-size: 0.9em;">${l}</span>`).join('') || ''}
                            </span>
                            <span style="flex: 1; text-align: right;">$${item.price.toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="text-align: right; font-size: 1.2em; font-weight: bold; margin-top: 15px; padding-top: 15px; border-top: 2px solid #333;">
                    Box Total: $${totalPrice.toFixed(2)}
                </div>
            </div>
        `;
    }).join('');
}

async function completeAudit() {
    if (currentAuditSession.length === 0) {
        alert('No boxes to audit!');
        return;
    }
    
    // Save audit to backend
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'save_audit',
                audit: {
                    timestamp: new Date().toISOString(),
                    boxes: currentAuditSession,
                    completed_by: currentUser.id
                }
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Error saving audit: ' + data.error);
        } else {
            alert('Audit saved! You can now finalize it from the Finalize RMA menu.');
            
            // Reset session
            currentAuditSession = [];
            currentBox = null;
            lastScannedItem = null;
            renderAuditBoxes();
            
            showScreen('mainMenu');
        }
    } catch (error) {
        alert('Error saving audit: ' + error.message);
        console.error('Save error:', error);
    }
}

// =============================================================================
// FINALIZE RMA
// =============================================================================

async function loadPendingAudits() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'get_pending_audits'})
        });
        
        const data = await response.json();
        const audits = data.audits || [];
        
        const container = document.getElementById('pendingAudits');
        
        if (audits.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666;">No pending audits to finalize</p>';
            return;
        }
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Boxes</th>
                        <th>Total Value</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${audits.map(audit => {
                        const totalValue = audit.boxes.reduce((sum, box) => 
                            sum + box.items.reduce((s, item) => s + item.price, 0), 0);
                        return `
                            <tr>
                                <td>${new Date(audit.timestamp).toLocaleString()}</td>
                                <td>${audit.boxes.length}</td>
                                <td>$${totalValue.toFixed(2)}</td>
                                <td>${audit.finalized ? '<span style="color: green;">✓ Finalized</span>' : '<span style="color: orange;">Pending</span>'}</td>
                                <td>
                                    <button class="btn" onclick='openFinalizeModal(${JSON.stringify(audit)})'>
                                        ${audit.finalized ? 'View' : 'Finalize'}
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading audits:', error);
    }
}

function openFinalizeModal(audit) {
    const content = document.getElementById('finalizeContent');
    
    const isFinalized = audit.finalized;
    
    content.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h4>Audit Date: ${new Date(audit.timestamp).toLocaleString()}</h4>
            <p>Total Boxes: ${audit.boxes.length}</p>
            <div style="margin-top: 15px;">
                <label style="font-weight: bold; margin-right: 10px;">Status:</label>
                <select id="auditStatus" ${isFinalized ? 'disabled' : ''} style="padding: 8px; border-radius: 5px; border: 1px solid #ddd;">
                    <option value="Received" ${audit.status === 'Received' ? 'selected' : ''}>Received</option>
                    <option value="In Progress" ${audit.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                    <option value="Completed" ${audit.status === 'Completed' ? 'selected' : ''}>Completed</option>
                </select>
                ${!isFinalized ? `<button class="btn" onclick="updateAuditStatus(${audit.id})" style="margin-left: 10px;">Update Status</button>` : ''}
            </div>
        </div>
        
        ${audit.boxes.map(box => {
            const boxTotal = box.items.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
            return `
                <div style="border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; border-radius: 5px;">
                    <h4>Box ${box.boxNumber} - ${box.customerName}</h4>
                    <p><strong>Tracking:</strong> ${box.tracking} | <strong>RMA:</strong> ${box.rmaNumber}</p>
                    
                    <table class="editable-table" style="margin-top: 10px;">
                        <thead>
                            <tr>
                                <th>SKU</th>
                                <th>Labels</th>
                                <th>Price</th>
                                <th>Payment Type</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${box.items.map((item, idx) => `
                                <tr>
                                    <td>${item.sku}${item.nio ? ' <span style="color:red;">(NIO)</span>' : ''}</td>
                                    <td>${item.labels?.join(', ') || '-'}</td>
                                    <td>
                                        <input type="number" 
                                            step="0.01" 
                                            value="${item.price}" 
                                            data-box="${box.boxNumber}" 
                                            data-item="${idx}"
                                            ${isFinalized ? 'readonly' : ''}
                                            style="width: 80px;">
                                    </td>
                                    <td>
                                        <select data-box="${box.boxNumber}" data-item="${idx}" data-field="payment_type" ${isFinalized ? 'disabled' : ''}>
                                            <option value="">-- Select --</option>
                                            <option value="Shopify" ${item.payment_type === 'Shopify' ? 'selected' : ''}>Shopify</option>
                                            <option value="Auth.net" ${item.payment_type === 'Auth.net' ? 'selected' : ''}>Auth.net</option>
                                            <option value="Customer Credit" ${item.payment_type === 'Customer Credit' ? 'selected' : ''}>Customer Credit</option>
                                            <option value="Exchange" ${item.payment_type === 'Exchange' ? 'selected' : ''}>Exchange</option>
                                        </select>
                                    </td>
                                    <td>
                                        <input type="text" 
                                            value="${item.notes || ''}" 
                                            data-box="${box.boxNumber}" 
                                            data-item="${idx}"
                                            data-field="notes"
                                            ${isFinalized ? 'readonly' : ''}
                                            placeholder="Notes...">
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="text-align: right; margin-top: 10px; font-weight: bold;">
                        Box Total: $${boxTotal.toFixed(2)}
                    </div>
                </div>
            `;
        }).join('')}
        
        ${!isFinalized ? `
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-success" onclick="saveFinalizedAudit(${audit.id})">Save & Finalize</button>
            </div>
        ` : ''}
    `;
    
    document.getElementById('finalizeModal').classList.add('active');
}

function closeFinalizeModal() {
    document.getElementById('finalizeModal').classList.remove('active');
}

async function saveFinalizedAudit(auditId) {
    // Collect all updated data from the form
    const boxes = [];
    document.querySelectorAll('.editable-table').forEach(table => {
        const rows = table.querySelectorAll('tbody tr');
        const items = [];
        
        rows.forEach(row => {
            const priceInput = row.querySelector('input[type="number"]');
            const paymentSelect = row.querySelector('select[data-field="payment_type"]');
            const notesInput = row.querySelector('input[data-field="notes"]');
            
            items.push({
                price: parseFloat(priceInput.value) || 0,
                payment_type: paymentSelect.value,
                notes: notesInput.value
            });
        });
        
        boxes.push({ items });
    });
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'finalize_audit',
                audit_id: auditId,
                boxes: boxes
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Error finalizing audit: ' + data.error);
        } else {
            alert('Audit finalized successfully!');
            closeFinalizeModal();
            loadPendingAudits();
        }
    } catch (error) {
        alert('Error finalizing audit: ' + error.message);
        console.error('Finalize error:', error);
    }
}

async function updateAuditStatus(auditId) {
    const status = document.getElementById('auditStatus').value;
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'update_audit_status',
                audit_id: auditId,
                status: status
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Error updating status: ' + data.error);
        } else {
            alert('Status updated successfully!');
            loadPendingAudits();
        }
    } catch (error) {
        alert('Error updating status: ' + error.message);
        console.error('Status update error:', error);
    }
}
