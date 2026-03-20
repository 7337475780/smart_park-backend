const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ParkingSlot, ActivityLog, Settings, User } = require('./models');

const app = express();
const port = process.env.PORT || 5000;

// Ensure uploads directory exists at startup
const uploadDir = path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('Created uploads directory at:', uploadDir);
  } else {
    console.log('Uploads directory already exists at:', uploadDir);
  }
} catch (e) {
  console.error('Error creating uploads directory:', e);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Set up multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');
        // Initialize default slots if DB is empty
        const count = await ParkingSlot.countDocuments();
        if (count === 0) {
            const defaultSlots = Array.from({ length: 12 }, (_, i) => ({
                slotId: `A${i + 1}`
            }));
            await ParkingSlot.insertMany(defaultSlots);
            console.log('Initialized 12 default parking slots');
        }

        // Initialize default settings if DB is empty
        const settingsCount = await Settings.countDocuments();
        if (settingsCount === 0) {
            await new Settings({ totalSlots: 10, fineAmount: 50, hourlyRate: 20 }).save();
            console.log('Initialized default settings');
        }

        // Initialize default admin user if no users exist
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            await new User({ username: 'admin', password: 'password123', role: 'admin' }).save();
            console.log('Initialized default admin user (admin / password123)');
        }
    }).catch(err => console.error('MongoDB connection error:', err));

// Wait for DB utility
const checkDb = (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database not connected yet' });
    }
    next();
};

// --- DATA ENDPOINTS ---

// Get all slots and logs
app.get('/api/status', checkDb, async (req, res) => {
    try {
        const allSlots = (await ParkingSlot.find()).sort((a, b) => {
            const aMatch = (a.slotId || '').match(/([A-Z]+)(\d+)/);
            const bMatch = (b.slotId || '').match(/([A-Z]+)(\d+)/);
            if (aMatch && bMatch) {
                if (aMatch[1] !== bMatch[1]) return aMatch[1].localeCompare(bMatch[1]);
                return parseInt(aMatch[2]) - parseInt(bMatch[2]);
            }
            return (a.slotId || '').localeCompare(b.slotId || '');
        });
        const logs = await ActivityLog.find().sort({ timestamp: -1 }).limit(50);
        const settings = await Settings.findOne() || { totalSlots: 12, fineAmount: 50, hourlyRate: 20 };

        // Respect the configured totalSlots limit — only expose up to that many slots
        const slots = allSlots.slice(0, settings.totalSlots);

        // Dynamic Revenue Calculation
        const revenueLogs = await ActivityLog.aggregate([
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalRevenue = revenueLogs.length > 0 ? revenueLogs[0].total : 0;

        const stats = {
            available: slots.filter(s => s.status === 'available').length,
            occupied: slots.filter(s => s.status === 'occupied').length,
            booked: slots.filter(s => s.status === 'booked').length,
            fined: slots.filter(s => s.status === 'fined').length,
            totalRevenue: totalRevenue
        };

        res.json({ slots, logs, stats, settings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update a slot (Used by frontend Manual Simulator / Booking)
app.post('/api/slots/:id', checkDb, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body; // { status, plateNumber, etc }

        const slot = await ParkingSlot.findOneAndUpdate({ slotId: id }, updates, { new: true });
        res.json(slot);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a log
app.post('/api/logs', checkDb, async (req, res) => {
    try {
        const log = new ActivityLog(req.body);
        await log.save();
        res.json(log);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Settings
app.post('/api/settings', checkDb, async (req, res) => {
    try {
        const { totalSlots, fineAmount, hourlyRate } = req.body;

        let settings = await Settings.findOne();
        if (!settings) settings = new Settings();

        const oldTotalSlots = settings.totalSlots;
        if (totalSlots !== undefined && totalSlots !== null) settings.totalSlots = totalSlots;
        if (fineAmount !== undefined && fineAmount !== null) settings.fineAmount = fineAmount;
        if (hourlyRate !== undefined && hourlyRate !== null) settings.hourlyRate = hourlyRate;
        await settings.save();

        if (totalSlots !== undefined && totalSlots !== null) {
            const existingSlots = await ParkingSlot.find({}, { slotId: 1 });
            const existingIds = new Set(existingSlots.map(s => s.slotId));

            // Create any missing slots up to totalSlots
            const newSlots = [];
            for (let i = 1; i <= totalSlots; i++) {
                if (!existingIds.has(`A${i}`)) {
                    newSlots.push({ slotId: `A${i}` });
                }
            }
            if (newSlots.length > 0) {
                await ParkingSlot.insertMany(newSlots, { ordered: false }).catch(e => console.log('Some slots already existed'));
            }

            // Remove any slots that exceed the new totalSlots limit
            const idsToRemove = [];
            for (const slot of existingSlots) {
                const match = slot.slotId.match(/^A(\d+)$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > totalSlots) {
                        idsToRemove.push(slot.slotId);
                    }
                }
            }
            if (idsToRemove.length > 0) {
                await ParkingSlot.deleteMany({ slotId: { $in: idsToRemove } });
            }
        }

        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- AUTH & USER ENDPOINTS ---

app.post('/api/register', checkDb, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ error: 'Username already exists' });

        const user = new User({ username, password, role: 'user' });
        await user.save();

        res.json({ _id: user._id, username: user.username, role: user.role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', checkDb, async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });

        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ _id: user._id, username: user.username, role: user.role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', checkDb, async (req, res) => {
    try {
        const users = await User.find({}, '-password').sort({ role: 1, username: 1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users/:id/role', checkDb, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

        const user = await User.findByIdAndUpdate(id, { role }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GEMINI ENDPOINT ---

app.post('/api/analyze-parking', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image provided' });
        if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY missing.' });

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // Convert multer file buffer to base64
        const base64Image = req.file.buffer.toString('base64');

        // Save the latest image to disk for testing/preview
        const uploadPath = path.join(uploadDir, 'latest.jpg');
        fs.writeFileSync(uploadPath, req.file.buffer);

        // We send a much more strict prompt expecting slot mappings
        const prompt = `
      Analyze this image from an AI Smart Parking camera viewing a parking slot.
      The environment is a smart parking demo using actual vehicles or cardboard car cutouts.
      Return a strictly formatted JSON object with the following fields:
      - "carDetected": boolean (STRICT: true ONLY if a vehicle OR a car-shaped cardboard model is present. If ANY other object is detected like a person, hand, face, or clutter, set to false)
      - "licensePlate": string (read a plate if clearly visible on the car or model, otherwise "")
      - "parkingStatus": string ("good" if parked inside lines, "bad" if across lines, "none" if empty)
      - "suggestedSlotId": string (The slot ID like "A1", "A2", or "A3" where the camera is pointed)
      
      Return ONLY valid JSON. Keep it raw without any markdown wrapping.
      Example: {"carDetected": true, "licensePlate": "AB1234", "parkingStatus": "good", "suggestedSlotId": "A1"}
    `;

        const result = await model.generateContent([{ inlineData: { data: base64Image, mimeType: req.file.mimetype } }, prompt]);
        const response = await result.response;
        const text = response.text();
        const cleanJson = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        const analysis = JSON.parse(cleanJson);

        if (mongoose.connection.readyState === 1) {
            const targetSlot = analysis.suggestedSlotId || 'A1';

            if (analysis.carDetected) {
                let newStatus = analysis.parkingStatus === 'bad' ? 'fined' : 'occupied';
                let eventName = analysis.parkingStatus === 'bad' ? 'CAMERA: FINE ISSUED' : 'CAMERA: ENTRY';
                let details = analysis.parkingStatus === 'bad' ? 'Improper parking alignment' : 'Detected via Vision API';

                // Update DB
                await ParkingSlot.findOneAndUpdate(
                    { slotId: targetSlot },
                    { status: newStatus, plateNumber: analysis.licensePlate || 'UNKNOWN', entryTime: new Date() }
                );

                // Record Log
                await new ActivityLog({
                    event: eventName,
                    plateNumber: analysis.licensePlate || 'UNKNOWN',
                    slotId: targetSlot,
                    details: details
                }).save();
            } else {
                // No car detected - register as EXIT if it was previously occupied or fined
                const slot = await ParkingSlot.findOne({ slotId: targetSlot });
                if (slot && (slot.status === 'occupied' || slot.status === 'fined')) {
                    const settings = await Settings.findOne() || { hourlyRate: 20 };
                    const entryTime = slot.entryTime || new Date();
                    const now = new Date();
                    const durationMs = now - entryTime;
                    // Round up to nearest hour, minimum 1 hour
                    const durationHours = Math.max(1, Math.ceil(durationMs / (1000 * 60 * 60)));
                    const amount = durationHours * settings.hourlyRate;

                    await ParkingSlot.findOneAndUpdate(
                        { slotId: targetSlot },
                        { status: 'available', plateNumber: null, entryTime: null }
                    );

                    await new ActivityLog({
                        event: 'CAMERA: EXIT',
                        plateNumber: slot.plateNumber || 'UNKNOWN',
                        slotId: targetSlot,
                        details: `Vehicle departure detected. Duration: ${durationHours}h. Fee: ₹${amount}`,
                        amount: amount
                    }).save();
                }
            }
        }

        res.json(analysis);

    } catch (error) {
        console.error('Error in analyze-parking:', error);
        res.status(500).json({ error: 'Failed to analyze the image', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
