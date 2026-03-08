import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth';
import chatRouter from './routes/chat';
import shellRouter from './routes/shell';
import agentRouter from './routes/agent';
import settingsRouter from './routes/settings';
import { AuthenticatedRequest } from './types/index';

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// All API routes require authentication
app.use('/api', requireAuth as express.RequestHandler);

app.use('/api/chat', chatRouter);
app.use('/api/shell', shellRouter);
app.use('/api/agent', agentRouter);
app.use('/api/settings', settingsRouter);

app.get('/api/me', (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
