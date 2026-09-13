import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { processSync } from './controllers/syncController.js';
import { getSystemStats } from './controllers/adminController.js';

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/msme_ledger';

// Standard Middleware
app.use(cors());
app.use(express.json());

// Milestone 6: Wire the Background Sync Route
app.post('/api/v1/sync', processSync);

// Admin Metrics Route
app.get('/api/v1/admin/stats', getSystemStats);

// Database Connection & Server Initialization
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Successfully connected to MongoDB.');
    app.listen(PORT, () => {
      console.log(`Express server is running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB.', error);
    process.exit(1);
  });
