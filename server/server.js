const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
app.use(express.json({ limit: '3mb' }));

const dataFile =
  process.env.EVENTS_FILE || path.join(__dirname, 'data', 'events.json');
const adminPassword = process.env.ADMIN_PASSWORD || 'H3Leaf';

const ensureDataDir = async () => {
  const dir = path.dirname(dataFile);
  await fs.mkdir(dir, { recursive: true });
};

const readEvents = async () => {
  try {
    const raw = await fs.readFile(dataFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writeEvents = async (events) => {
  await ensureDataDir();
  const tempFile = `${dataFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(events, null, 2), 'utf-8');
  await fs.rename(tempFile, dataFile);
};

const requireAuth = (req, res, next) => {
  const password = req.header('x-admin-password');
  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
};

app.get('/api/events', async (_req, res) => {
  try {
    const events = await readEvents();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(events);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load events' });
  }
});

app.post('/api/auth', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

app.put('/api/events', requireAuth, async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid events payload' });
  }
  try {
    await writeEvents(events);
    return res.json(events);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save events' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Events API listening on port ${port}`);
});
