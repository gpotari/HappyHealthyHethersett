const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
app.use(express.json({ limit: '3mb' }));

const dataFile =
  process.env.EVENTS_FILE || path.join(__dirname, 'data', 'events.json');
const reportsFile =
  process.env.LITTER_REPORTS_FILE || path.join(__dirname, 'data', 'litter-reports.json');
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

const ensureReportsDir = async () => {
  const dir = path.dirname(reportsFile);
  await fs.mkdir(dir, { recursive: true });
};

const readReports = async () => {
  try {
    const raw = await fs.readFile(reportsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writeReports = async (reports) => {
  await ensureReportsDir();
  const tempFile = `${reportsFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(reports, null, 2), 'utf-8');
  await fs.rename(tempFile, reportsFile);
};

const cleanString = (value, maxLength = 1000) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
};

const mapLinkFor = (lat, lng) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;

const normalizeReport = (payload) => {
  const lat = Number(payload?.lat);
  const lng = Number(payload?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (lat < 52.55 || lat > 52.64 || lng < 1.1 || lng > 1.24) {
    return null;
  }

  const allowedAmounts = new Set(['Small amount', 'Medium amount', 'Large amount']);
  const amount = cleanString(payload?.amount, 40);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    locationLabel: cleanString(payload?.locationLabel, 80) || 'Selected map point',
    lat,
    lng,
    amount: allowedAmounts.has(amount) ? amount : '',
    comment: cleanString(payload?.comment, 1200),
    contact: cleanString(payload?.contact, 180),
    mapLink: mapLinkFor(lat, lng)
  };
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

app.post('/api/litter-reports', async (req, res) => {
  const report = normalizeReport(req.body);
  if (!report) {
    return res.status(400).json({ error: 'Invalid litter report payload' });
  }

  try {
    const reports = await readReports();
    const updated = [report, ...reports].slice(0, 500);
    await writeReports(updated);
    return res.status(201).json(report);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save litter report' });
  }
});

app.get('/api/litter-reports', requireAuth, async (_req, res) => {
  try {
    const reports = await readReports();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(reports);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load litter reports' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Events API listening on port ${port}`);
});
