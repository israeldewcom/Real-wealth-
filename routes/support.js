const express = require('express');
const {
  createSupportTicket,
  getUserTickets,
  getFAQ,
  getAllTickets,
  updateTicketStatus
} = require('../controllers/supportController');
const { auth, admin } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/faq', getFAQ);

// Protected routes
router.use(auth);

router.post('/tickets', createSupportTicket);
router.get('/tickets', getUserTickets);

// Admin routes
router.get('/admin/tickets', admin, getAllTickets);
router.put('/admin/tickets/:id/status', admin, updateTicketStatus);

module.exports = router;
