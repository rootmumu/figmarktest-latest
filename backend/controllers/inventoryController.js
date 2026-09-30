const InventoryItem = require('../models/InventoryItem');
const ComponentRequest = require('../models/ComponentRequest');
const PurchaseOrder = require('../models/PurchaseOrder');
const Project = require('../models/Project');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');

// Helper to check for low stock and notify Accounts and HR users
const checkLowStockAndNotify = async (item) => {
  if (item.availableQuantity <= item.minThreshold) {
    const User = require('../models/User');
    const recipients = await User.find({ role: { $in: ['Accounts', 'HR'] } });
    for (const recipient of recipients) {
      const existing = await Notification.findOne({
        user: recipient._id,
        message: `Low Stock Alert: ${item.name} is low on stock (${item.availableQuantity} left).`,
        read: false
      });
      if (!existing) {
        await Notification.create({
          user: recipient._id,
          message: `Low Stock Alert: ${item.name} is low on stock (${item.availableQuantity} left).`,
          sender: 'Inventory System',
          type: 'danger',
          link: `/inventory-dashboard?search=${encodeURIComponent(item.name)}`
        });
      }
    }
  }
};

// Helper to send inventory notifications to Admin and HR
const sendInventoryNotification = async (req, message) => {
  try {
    const hrAdmins = await User.find({ role: { $in: ['HR', 'Admin'] } });
    for (const recipient of hrAdmins) {
      // Don't notify the person who performed the action
      if (recipient._id.toString() === req.user._id.toString()) continue;

      const notif = await Notification.create({
        user: recipient._id,
        sender: req.user.name,
        message,
        type: 'info',
        link: '/inventory-dashboard'
      });
      const io = req.app.get('socketio');
      if (io) {
        io.to(recipient._id.toString()).emit('new-notification', notif);
      }
    }
  } catch (error) {
    console.error('Error sending inventory notification:', error);
  }
};

// ==========================================
// 1. Inventory Items CRUD (Admin/HR/Accounts)
// ==========================================

// Get all inventory items
const getItems = async (req, res) => {
  try {
    const items = await InventoryItem.find({});
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new inventory item
const createItem = async (req, res) => {
  try {
    let { name, category, totalQuantity, availableQuantity, defectiveQuantity, unitCost, minThreshold, location, description } = req.body;
    
    // Validate Component Name
    if (!name || typeof name !== 'string') return res.status(400).json({ message: 'Component Name is required.' });
    name = name.trim();
    if (!name) return res.status(400).json({ message: 'Component Name cannot be only whitespace.' });
    if (name.length > 100) return res.status(400).json({ message: 'Component Name must be less than 100 characters.' });

    // Validate Category
    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ message: 'Category is required.' });
    }
    category = category.trim();

    // Validate Total Quantity
    if (totalQuantity === undefined || totalQuantity === null || totalQuantity <= 0 || !Number.isInteger(Number(totalQuantity))) {
      return res.status(400).json({ message: 'Total Quantity must be a whole number greater than 0.' });
    }

    // Validate Available Quantity
    if (availableQuantity === undefined || availableQuantity === null || availableQuantity < 0 || !Number.isInteger(Number(availableQuantity))) {
      return res.status(400).json({ message: 'Available Quantity must be a whole number 0 or greater.' });
    }

    // Validate Defective Quantity
    if (defectiveQuantity === undefined || defectiveQuantity === null || defectiveQuantity < 0 || !Number.isInteger(Number(defectiveQuantity))) {
      return res.status(400).json({ message: 'Defective Quantity must be a whole number 0 or greater.' });
    }

    // Quantity Consistency Check
    if (Number(availableQuantity) + Number(defectiveQuantity) !== Number(totalQuantity)) {
      return res.status(400).json({ message: 'Quantity Mismatch: Available + Defective must equal Total Quantity.' });
    }

    // Validate Unit Cost
    if (unitCost === undefined || unitCost === null || unitCost <= 0 || isNaN(Number(unitCost))) {
      return res.status(400).json({ message: 'Unit Cost must be a valid number greater than 0.' });
    }

    // Validate Min Threshold
    if (minThreshold === undefined || minThreshold === null || minThreshold < 0 || !Number.isInteger(Number(minThreshold))) {
      return res.status(400).json({ message: 'Minimum Threshold must be a whole number 0 or greater.' });
    }

    // Validate Location
    if (!location || typeof location !== 'string') return res.status(400).json({ message: 'Location is required.' });
    location = location.trim();
    if (!location) return res.status(400).json({ message: 'Location cannot be empty.' });
    if (location.length > 50) return res.status(400).json({ message: 'Location must be less than 50 characters.' });

    // Validate Description
    if (description && typeof description === 'string') {
      description = description.trim();
      if (description.length > 500) return res.status(400).json({ message: 'Description must be less than 500 characters.' });
    } else {
      description = "";
    }

    // Check for uniqueness (case-insensitive)
    const itemExists = await InventoryItem.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (itemExists) {
      return res.status(400).json({ message: 'A component with this name already exists.' });
    }

    const item = await InventoryItem.create({
      name,
      category,
      totalQuantity: Number(totalQuantity),
      availableQuantity: Number(availableQuantity),
      defectiveQuantity: Number(defectiveQuantity),
      unitCost: Number(unitCost),
      minThreshold: Number(minThreshold),
      location,
      description
    });

    // Log Activity
    await ActivityLog.create({
      user: req.user._id,
      action: `Created inventory item: ${name} (${category})`,
      details: `Quantity: ${totalQuantity}, Cost per unit: ₹${unitCost}`
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update an inventory item
const updateItem = async (req, res) => {
  try {
    console.log('Update Request Body:', req.body);
    const item = await InventoryItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const { name, category, totalQuantity, availableQuantity, defectiveQuantity, unitCost, minThreshold, location, description } = req.body;
    
    item.name = name || item.name;
    item.category = category || item.category;
    item.defectiveQuantity = defectiveQuantity !== undefined ? defectiveQuantity : item.defectiveQuantity;
    
    if (totalQuantity !== undefined) {
      const diff = totalQuantity - item.totalQuantity;
      item.totalQuantity = totalQuantity;
      if (availableQuantity === undefined) {
        item.availableQuantity = Math.max(0, item.availableQuantity + diff);
      }
    }
    if (availableQuantity !== undefined) {
      item.availableQuantity = availableQuantity;
    }
    
    item.unitCost = unitCost !== undefined ? unitCost : item.unitCost;
    item.minThreshold = minThreshold !== undefined ? minThreshold : item.minThreshold;
    item.location = location || item.location;
    item.description = description || item.description;

    const updatedItem = await item.save();
    console.log('Successfully updated item in DB:', updatedItem);
    await checkLowStockAndNotify(updatedItem);
    await sendInventoryNotification(req, `${req.user.name} updated inventory component "${updatedItem.name}".`);
    res.json(updatedItem);
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ message: error.message });
  }
};

// Delete an inventory item
const deleteItem = async (req, res) => {
  try {
    const deletedItem = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!deletedItem) {
      return res.status(404).json({ message: 'Item not found' });
    }

    await sendInventoryNotification(req, `${req.user.name} deleted inventory component "${deletedItem.name}".`);

    res.json({ message: 'Item removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ==========================================
// 2. Component Requests (Employee -> TL Approval)
// ==========================================

const createRequest = async (req, res) => {
  try {
    const { projectId, items, teamLeadId } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items requested' });
    }

    // Check availability first (do NOT deduct yet)
    for (const reqItem of items) {
      const invItem = await InventoryItem.findById(reqItem.itemId);
      if (!invItem) {
        return res.status(404).json({ message: `Component with ID ${reqItem.itemId} not found` });
      }
      if (invItem.availableQuantity < reqItem.quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${invItem.name}. Requested: ${reqItem.quantity}, Available: ${invItem.availableQuantity}` 
        });
      }
    }

    const request = await ComponentRequest.create({
      employeeId: req.user._id,
      projectId,
      items,
      teamLeadId,
      status: 'Pending TL'
    });

    if (projectId) {
      const project = await Project.findById(projectId);
      if (project) {
        for (const reqItem of items) {
          const invItem = await InventoryItem.findById(reqItem.itemId);
          const compName = invItem ? invItem.name : 'Component';
          project.timeline.push({
            message: `Hardware Request: ${compName} (Qty: ${reqItem.quantity})`,
            author: req.user.name,
            date: Date.now()
          });
        }
        await project.save();
        try {
          await ActivityLog.create({
            projectId: project._id,
            projectName: project.title,
            user: req.user._id,
            userName: req.user.name,
            action: `Component requested: ${items.length} item(s)`,
            roleScope: ['Admin', 'HR', 'TeamLead']
          });
        } catch (e) {
          console.error("Activity log error:", e);
        }
      }
    }

    // Notify Team Lead
    await Notification.create({
      user: teamLeadId,
      sender: req.user.name,
      message: `${req.user.name} submitted a new electronics component request.`,
      type: 'info',
      link: `/inventory-requests?search=${encodeURIComponent(req.user.name)}`
    });

    // Notify HR / Admin
    try {
      const hrUsers = await User.find({ role: { $in: ['HR', 'Admin'] } });
      for (const hr of hrUsers) {
        await Notification.create({
          user: hr._id,
          sender: req.user.name,
          message: `${req.user.name} submitted a component request for review.`,
          type: 'info',
          link: `/inventory-requests?search=${encodeURIComponent(req.user.name)}`
        });
      }
    } catch (e) {
      console.error("HR notification error:", e);
    }

    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getRequests = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'Employee') {
      query.employeeId = req.user._id;
    } else if (req.user.role === 'TeamLead') {
      query.teamLeadId = req.user._id;
    }

    const requests = await ComponentRequest.find(query)
      .populate('employeeId', 'name email')
      .populate('projectId', 'title')
      .populate('teamLeadId', 'name')
      .populate('items.itemId', 'name category availableQuantity location');

    const formattedRequests = requests.map(r => r.toObject());

    // Pull hardware requests from Projects so project-level hardware allocations update live
    const Project = require('../models/Project');
    const projects = await Project.find()
      .populate('teamLead', 'name')
      .populate('teamLeads', 'name')
      .populate('assignedEmployees.employeeId', 'name');

    for (const proj of projects) {
      if (proj.hardwareRequests && proj.hardwareRequests.length > 0) {
        for (const hw of proj.hardwareRequests) {
          // Role filtering if needed
          if (req.user.role === 'Employee') {
            const empName = req.user.name ? req.user.name.toLowerCase() : '';
            const reqBy = (hw.requestedBy || '').toLowerCase();
            if (!reqBy.includes(empName) && empName !== reqBy) {
              continue;
            }
          }

          const tlName = (proj.teamLead && proj.teamLead.name) ||
            (proj.teamLeads && proj.teamLeads[0] && proj.teamLeads[0].name) ||
            'Team Lead';

          const mappedStatus = hw.status === 'Approved' ? 'Approved by TL' :
            hw.status === 'Rejected' ? 'Rejected by TL' : 'Pending TL';

          formattedRequests.push({
            _id: hw._id || hw.id,
            createdAt: hw.createdAt || proj.updatedAt || proj.createdAt,
            employeeId: { name: hw.requestedBy || 'Employee' },
            projectId: { _id: proj._id, title: proj.title },
            items: [{ itemId: { name: hw.name }, quantity: hw.quantity }],
            teamLeadId: { name: tlName },
            tlComments: hw.reason || '-',
            status: mappedStatus
          });
        }
      }
    }

    // Sort all records by createdAt descending
    formattedRequests.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json(formattedRequests);
  } catch (error) {
    console.error("Error fetching inventory requests:", error);
    res.status(500).json({ message: error.message });
  }
};

// Review component request (TL / Admin)
const reviewRequest = async (req, res) => {
  try {
    const { status, tlComments } = req.body;
    let request = await ComponentRequest.findById(req.params.id);

    if (!request) {
      // Check if this request is a project hardware request
      const Project = require('../models/Project');
      const project = await Project.findOne({ 'hardwareRequests._id': req.params.id });
      if (project) {
        const hwReq = project.hardwareRequests.id(req.params.id);
        if (hwReq) {
          if (hwReq.status !== 'Pending') {
            return res.status(400).json({ message: 'This request has already been reviewed.' });
          }

          if (status === 'Approved by TL' || status === 'Approved') {
            hwReq.status = 'Approved';
            if (tlComments) hwReq.reason = tlComments;

            // Deduct from main inventory if matching item exists
            const invItem = await InventoryItem.findOne({ name: { $regex: new RegExp(`^${hwReq.name}$`, 'i') } });
            if (invItem) {
              if (invItem.availableQuantity < hwReq.quantity) {
                return res.status(400).json({
                  message: `Insufficient stock in inventory for ${invItem.name}. Available: ${invItem.availableQuantity}`
                });
              }
              invItem.availableQuantity -= hwReq.quantity;
              invItem.totalQuantity -= hwReq.quantity;
              await invItem.save();
              await checkLowStockAndNotify(invItem);
            }

            // Add or update project inventory
            const existingInv = project.inventory.find(i => i.name.toLowerCase() === hwReq.name.toLowerCase());
            if (existingInv) {
              existingInv.quantity += hwReq.quantity;
              existingInv.lastUpdated = Date.now();
            } else {
              project.inventory.push({
                name: hwReq.name,
                quantity: hwReq.quantity,
                lastUpdated: Date.now()
              });
            }

            // Log timeline
            project.timeline.push({
              message: `Hardware Approved: ${hwReq.name} (Qty: ${hwReq.quantity})`,
              author: req.user ? req.user.name : 'Team Leader',
              date: Date.now()
            });

            await project.save();
            return res.json({ message: 'Hardware request approved successfully', project });
          } else {
            hwReq.status = 'Rejected';
            if (tlComments) hwReq.reason = tlComments;

            // Log timeline
            project.timeline.push({
              message: `Hardware Rejected: ${hwReq.name}. Reason: ${tlComments || 'No reason provided'}`,
              author: req.user ? req.user.name : 'Team Leader',
              date: Date.now()
            });

            await project.save();
            return res.json({ message: 'Hardware request rejected successfully', project });
          }
        }
      }

      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'Pending TL') {
      return res.status(400).json({ message: 'This request has already been reviewed.' });
    }

    if (status === 'Approved by TL') {
      // Deduct quantity from availableQuantity and totalQuantity
      for (const reqItem of request.items) {
        const invItem = await InventoryItem.findById(reqItem.itemId);
        if (invItem.availableQuantity < reqItem.quantity) {
          return res.status(400).json({ 
            message: `Insufficient stock for ${invItem.name}. Cannot approve.` 
          });
        }
        invItem.availableQuantity -= reqItem.quantity;
        invItem.totalQuantity -= reqItem.quantity;
        await invItem.save();
        await checkLowStockAndNotify(invItem);
      }

      // Send detailed notification to HR and Accounts
      const populatedRequest = await ComponentRequest.findById(request._id)
        .populate('employeeId', 'name')
        .populate('projectId', 'title')
        .populate('items.itemId', 'name');

      const User = require('../models/User');
      const hrAndAccounts = await User.find({ role: { $in: ['HR', 'Accounts'] } });
      
      const componentDetails = populatedRequest.items.map(i => `${i.itemId?.name} (Qty: ${i.quantity})`).join(', ');
      const detailedMessage = `Inventory Request Approved: ${populatedRequest.employeeId?.name || 'Employee'} requested ${componentDetails} for project "${populatedRequest.projectId?.title || 'N/A'}", approved by Team Lead ${req.user.name}.`;

      for (const recipient of hrAndAccounts) {
        await Notification.create({
          user: recipient._id,
          message: detailedMessage,
          sender: 'Inventory System',
          type: 'success',
          link: `/inventory-records?search=${encodeURIComponent(populatedRequest.employeeId?.name || '')}`
        });
      }
    }

    request.status = status;
    request.tlComments = tlComments;
    await request.save();

    // Notify Employee
    await Notification.create({
      user: request.employeeId,
      sender: req.user.name,
      message: `Your component request was ${status === 'Approved by TL' ? 'Approved' : 'Rejected'} by your Team Lead.`,
      type: status === 'Approved by TL' ? 'success' : 'danger',
      link: `/inventory-dashboard?search=${encodeURIComponent(req.user.name)}`
    });

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ==========================================
// 3. Purchase Orders (Admin -> Accounts Approval)
// ==========================================

// Create Purchase Order (Admin)
const createPurchaseOrder = async (req, res) => {
  try {
    const { itemId, quantity, unitPrice } = req.body;

    const item = await InventoryItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    const totalCost = quantity * unitPrice;

    const purchaseOrder = await PurchaseOrder.create({
      itemId,
      quantity,
      unitPrice,
      totalCost,
      requestedBy: req.user._id,
      status: 'Pending Accounts'
    });

    // Notify all Accounts users (or via role)
    // For simplicity, create notifications for any account users if needed, or notify the Accounts room via socket
    const io = req.app.get('socketio');
    if (io) {
      io.to('Accounts').emit('newPurchaseOrder', {
        message: `New Restock Purchase Order created for ${item.name}`,
        purchaseOrder
      });
    }

    res.status(201).json(purchaseOrder);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all Purchase Orders
const getPurchaseOrders = async (req, res) => {
  try {
    const pos = await PurchaseOrder.find({})
      .populate('itemId', 'name category unitCost')
      .populate('requestedBy', 'name')
      .populate('approvedBy', 'name');
    res.json(pos);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Approve/Reject Purchase Order (Accounts)
const approvePurchaseOrder = async (req, res) => {
  try {
    const { status, accountsComments } = req.body;
    const po = await PurchaseOrder.findById(req.params.id).populate('itemId');

    if (!po) {
      return res.status(404).json({ message: 'Purchase Order not found' });
    }

    po.status = status;
    po.approvedBy = req.user._id;
    po.accountsComments = accountsComments;
    await po.save();

    // If approved, notify admin
    await Notification.create({
      user: po.requestedBy,
      sender: req.user.name,
      message: `Purchase Order for ${po.itemId.name} was ${status} by Accounts.`,
      type: status === 'Approved' ? 'success' : 'danger',
      link: `/inventory-dashboard?search=${encodeURIComponent(po.itemId.name)}`
    });

    res.json(po);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark Purchase Order as Received (Admin) and update stock
const receivePurchaseOrder = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ message: 'Purchase Order not found' });
    }

    if (po.status !== 'Approved') {
      return res.status(400).json({ message: 'Order must be Approved before receiving.' });
    }

    po.status = 'Received';
    await po.save();

    // Increment Inventory stock
    const item = await InventoryItem.findById(po.itemId);
    if (item) {
      item.totalQuantity += po.quantity;
      item.availableQuantity += po.quantity;
      // Update unitCost if needed based on purchase price
      item.unitCost = po.unitPrice;
      await item.save();
    }

    // Log Activity
    await ActivityLog.create({
      user: req.user._id,
      action: `Received restock order for ${item.name}`,
      details: `Quantity received: ${po.quantity}`
    });

    res.json(po);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ==========================================
// 4. Financial/Asset Reports (Accounts/Admin)
// ==========================================

const getFinancials = async (req, res) => {
  try {
    // 1. Calculate current asset value
    const items = await InventoryItem.find({});
    let totalAssetValue = 0;
    items.forEach(item => {
      totalAssetValue += (item.totalQuantity * item.unitCost);
    });

    // 2. Calculate expenses from Received Purchase Orders
    const receivedPOs = await PurchaseOrder.find({ status: 'Received' });
    let totalSpending = 0;
    receivedPOs.forEach(po => {
      totalSpending += po.totalCost;
    });

    // 3. Pending commitments (Approved but not yet Received)
    const approvedPOs = await PurchaseOrder.find({ status: 'Approved' });
    let pendingCommitments = 0;
    approvedPOs.forEach(po => {
      pendingCommitments += po.totalCost;
    });

    res.json({
      totalAssetValue,
      totalSpending,
      pendingCommitments,
      itemCount: items.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// 5. Purchase Records (Accountant records actual offline purchases)
// ==========================================

/**
 * POST /inventory/purchases
 * Accountant records a completed offline purchase.
 * - If the component already exists in inventory → increments quantities.
 * - If the component is new → creates the InventoryItem automatically.
 * Always creates a PurchaseOrder (PurchaseRecord) document with status 'Completed'.
 */
const createPurchaseRecord = async (req, res) => {
  try {
    const {
      purchaseDate,
      componentName,
      category,
      storageLocation,
      quantityPurchased,
      unitCost,
      totalCost,
      approvedBy,
      purchasedBy,
      supplierName,
      invoiceNumber,
      remarks
    } = req.body;

    if (!componentName || !quantityPurchased || !unitCost || !purchaseDate) {
      return res.status(400).json({ message: 'componentName, quantityPurchased, unitCost and purchaseDate are required.' });
    }

    const qty = Number(quantityPurchased);
    const cost = Number(unitCost);
    const total = Number(totalCost) || qty * cost;

    // --- Find or create the inventory item ---
    let inventoryItem = await InventoryItem.findOne({
      name: { $regex: new RegExp(`^${componentName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') }
    });

    if (inventoryItem) {
      // Case 1: Existing component — increment quantities
      inventoryItem.totalQuantity     += qty;
      inventoryItem.availableQuantity += qty;
      // Update unit cost to latest purchase price
      inventoryItem.unitCost = cost;
      if (storageLocation) inventoryItem.location = storageLocation;
      await inventoryItem.save();
    } else {
      // Case 2: New component — create inventory item
      inventoryItem = await InventoryItem.create({
        name:              componentName,
        category:          category || 'Others',
        totalQuantity:     qty,
        availableQuantity: qty,
        defectiveQuantity: 0,
        unitCost:          cost,
        minThreshold:      5,
        location:          storageLocation || '',
        description:       remarks || ''
      });
    }

    // --- Create the purchase record ---
    const purchaseRecord = await PurchaseOrder.create({
      inventoryItemId:   inventoryItem._id,
      componentName,
      category:          category || inventoryItem.category,
      storageLocation:   storageLocation || inventoryItem.location,
      purchaseDate:      new Date(purchaseDate),
      quantityPurchased: qty,
      unitCost:          cost,
      totalCost:         total,
      approvedBy:        approvedBy || null,
      purchasedBy:       purchasedBy || null,
      recordedBy:        req.user._id,
      supplierName:      supplierName || '',
      invoiceNumber:     invoiceNumber || '',
      remarks:           remarks || '',
      status:            'Completed',
      transactionType:   'Purchase'
    });

    // --- Log the activity ---
    await ActivityLog.create({
      user:    req.user._id,
      action:  `Purchase recorded: ${componentName} (Qty: ${qty})`,
      details: `Total Cost: ₹${total} | Invoice: ${invoiceNumber || 'N/A'} | Supplier: ${supplierName || 'N/A'}`
    });

    // --- Notify HR and Admin ---
    const pluralS = componentName.endsWith('s') ? '' : 's';
    await sendInventoryNotification(req, `${req.user.name} added ${qty} ${componentName}${pluralS} to inventory.`);

    res.status(201).json({
      purchaseRecord,
      inventoryItem
    });
  } catch (error) {
    console.error('Error creating purchase record:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /inventory/purchases
 * Returns all purchase records sorted newest-first, with user references populated.
 */
const getPurchaseRecords = async (req, res) => {
  try {
    const records = await PurchaseOrder.find({})
      .populate('inventoryItemId', 'name category availableQuantity')
      .populate('approvedBy',  'name role')
      .populate('purchasedBy', 'name role')
      .populate('recordedBy',  'name role')
      .sort({ createdAt: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getItems,
  createItem,
  updateItem,
  deleteItem,
  createRequest,
  getRequests,
  reviewRequest,
  createPurchaseOrder,
  getPurchaseOrders,
  approvePurchaseOrder,
  receivePurchaseOrder,
  getFinancials,
  createPurchaseRecord,
  getPurchaseRecords
};
