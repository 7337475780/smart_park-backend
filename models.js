const mongoose = require('mongoose');

const parkingSlotSchema = new mongoose.Schema({
  slotId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['available', 'occupied', 'booked', 'fined'], default: 'available' },
  plateNumber: { type: String, default: null },
  entryTime: { type: Date, default: null },
  bookingTime: { type: Date, default: null }
});

const ActivityLogSchema = new mongoose.Schema({
  event: { type: String, required: true },
  plateNumber: { type: String, default: null },
  slotId: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
  details: { type: String, default: '' },
  amount: { type: Number, default: 0 }
});

const SettingsSchema = new mongoose.Schema({
  totalSlots: { type: Number, default: 12 },
  fineAmount: { type: Number, default: 50 },
  hourlyRate: { type: Number, default: 20 }
});

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
});

// We disable versionKey for cleaner JSON responses
const ParkingSlot = mongoose.model('ParkingSlot', parkingSlotSchema, 'parking_slots');
const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema, 'activity_logs');
const Settings = mongoose.model('Settings', SettingsSchema, 'settings');
const User = mongoose.model('User', UserSchema, 'users');

module.exports = { ParkingSlot, ActivityLog, Settings, User };
