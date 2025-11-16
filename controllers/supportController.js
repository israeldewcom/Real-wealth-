const SupportTicket = require('../models/SupportTicket');
const FAQ = require('../models/FAQ');
const logger = require('../utils/logger');

// @desc    Create support ticket
// @route   POST /api/support/tickets
// @access  Private
exports.createSupportTicket = async (req, res) => {
  try {
    const { subject, message, category, priority } = req.body;

    const ticket = await SupportTicket.create({
      user: req.user.id,
      subject,
      message,
      category: category || 'general',
      priority: priority || 'medium'
    });

    // Notify admin via Socket.IO
    const io = req.app.get('io');
    io.to('admin-room').emit('new-support-ticket', {
      message: 'New support ticket created',
      ticketId: ticket._id,
      userId: req.user.id,
      userName: req.user.full_name,
      subject: subject,
      category: category
    });

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      data: { ticket }
    });

  } catch (error) {
    logger.error('Create support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating support ticket'
    });
  }
};

// @desc    Get user support tickets
// @route   GET /api/support/tickets
// @access  Private
exports.getUserTickets = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user.id };
    if (status) query.status = status;

    const tickets = await SupportTicket.find(query)
      .sort({ created_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SupportTicket.countDocuments(query);

    res.json({
      success: true,
      data: {
        tickets,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total
      }
    });
  } catch (error) {
    logger.error('Get support tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching support tickets'
    });
  }
};

// @desc    Get FAQ
// @route   GET /api/support/faq
// @access  Public
exports.getFAQ = async (req, res) => {
  try {
    const faqs = await FAQ.find({ is_active: true })
      .sort({ order: 1, created_at: -1 });

    res.json({
      success: true,
      data: { faqs }
    });
  } catch (error) {
    logger.error('Get FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching FAQ'
    });
  }
};

// @desc    Get all support tickets (Admin)
// @route   GET /api/support/admin/tickets
// @access  Private/Admin
exports.getAllTickets = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = {};
    if (status) query.status = status;

    const tickets = await SupportTicket.find(query)
      .populate('user', 'full_name email phone')
      .sort({ created_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SupportTicket.countDocuments(query);

    res.json({
      success: true,
      data: {
        tickets,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total
      }
    });
  } catch (error) {
    logger.error('Get all tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching tickets'
    });
  }
};

// @desc    Update ticket status (Admin)
// @route   PUT /api/support/tickets/:id/status
// @access  Private/Admin
exports.updateTicketStatus = async (req, res) => {
  try {
    const { status, admin_response } = req.body;

    const ticket = await SupportTicket.findById(req.params.id).populate('user');
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    ticket.status = status;
    if (admin_response) {
      ticket.admin_response = admin_response;
      ticket.responded_at = new Date();
    }

    await ticket.save();

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${ticket.user._id}`).emit('ticket-updated', {
      message: `Your support ticket has been ${status}`,
      ticketId: ticket._id,
      status: status,
      adminResponse: admin_response
    });

    res.json({
      success: true,
      message: `Ticket ${status} successfully`,
      data: { ticket }
    });
  } catch (error) {
    logger.error('Update ticket status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating ticket status'
    });
  }
};
