const Meeting = require('../models/Meeting');

const Notification = require('../models/Notification');
const User = require('../models/User');

// Create a meeting
exports.createMeeting = async (req, res) => {
  try {
    const { title, description, scheduledTime, attendees } = req.body;

    if (!title || !scheduledTime || !attendees || !Array.isArray(attendees) || attendees.length === 0) {
      return res.status(400).json({ message: 'Title, scheduled time, and at least one attendee are required' });
    }

    if (new Date(scheduledTime) < new Date()) {
      return res.status(400).json({ message: 'Meeting time cannot be earlier than the current time.' });
    }

    // Ensure the creator is in the attendees list
    const finalAttendees = new Set(attendees);
    finalAttendees.add(req.user._id.toString());

    // Generate a Jitsi-compatible clean room name
    const cleanedTitle = title.replace(/[^a-zA-Z0-9]/g, '').substring(0, 15);
    const roomName = `pms-${cleanedTitle}-${Date.now()}`;

    const meeting = await Meeting.create({
      title,
      description,
      scheduledTime,
      attendees: Array.from(finalAttendees),
      roomName,
      scheduledBy: req.user._id
    });

    // Notify attendees and admins
    const admins = await User.find({ role: 'Admin' });
    const usersToNotify = new Set(Array.from(finalAttendees));
    admins.forEach(admin => usersToNotify.add(admin._id.toString()));
    usersToNotify.delete(req.user._id.toString()); // Don't notify the creator

    for (const userId of Array.from(usersToNotify)) {
      await Notification.create({
        user: userId,
        message: `You have been invited to a meeting: ${title}`,
        sender: req.user.name,
        type: 'info',
        link: '/attend-meeting'
      });
    }

    const populatedMeeting = await meeting.populate('scheduledBy', 'name email role');
    res.status(201).json(populatedMeeting);
  } catch (error) {
    console.error('Create Meeting Error:', error);
    res.status(500).json({ message: 'Server error while creating meeting' });
  }
};

// Get all meetings (upcoming first, sorted chronologically)
exports.getMeetings = async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'Admin') {
      query.attendees = req.user._id;
    }

    const meetings = await Meeting.find(query)
      .populate('scheduledBy', 'name email role')
      .populate('attendees', 'name email role')
      .sort({ scheduledTime: 1 });
    res.json(meetings);
  } catch (error) {
    console.error('Get Meetings Error:', error);
    res.status(500).json({ message: 'Server error while fetching meetings' });
  }
};

// Cancel/Delete a meeting
exports.deleteMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    await Meeting.findByIdAndDelete(req.params.id);
    res.json({ message: 'Meeting successfully cancelled' });
  } catch (error) {
    console.error('Delete Meeting Error:', error);
    res.status(500).json({ message: 'Server error while cancelling meeting' });
  }
};

// Join a meeting
exports.joinMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    if (req.user.role !== 'Admin' && !meeting.attendees.includes(req.user._id)) {
      return res.status(403).json({ message: 'You are not invited to this meeting' });
    }

    if (meeting.status === 'Completed') {
      return res.status(400).json({ message: 'This meeting has already ended' });
    }

    if (meeting.status === 'Scheduled') {
      meeting.status = 'InProgress';
      meeting.startTime = Date.now();
      await meeting.save();
    }

    res.json(meeting);
  } catch (error) {
    console.error('Join Meeting Error:', error);
    res.status(500).json({ message: 'Server error while joining meeting' });
  }
};

// End a meeting
exports.endMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    if (req.user.role !== 'Admin' && meeting.scheduledBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the organizer or Admin can end the meeting' });
    }

    if (meeting.status === 'Completed') {
      return res.status(400).json({ message: 'This meeting is already completed' });
    }

    meeting.status = 'Completed';
    meeting.endTime = Date.now();
    
    if (meeting.startTime) {
      meeting.actualDuration = meeting.endTime.getTime() - meeting.startTime.getTime();
    }
    
    await meeting.save();
    res.json(meeting);
  } catch (error) {
    console.error('End Meeting Error:', error);
    res.status(500).json({ message: 'Server error while ending meeting' });
  }
};
