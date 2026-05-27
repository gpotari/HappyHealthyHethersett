const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
app.use(express.json({ limit: '3mb' }));

const dataFile =
  process.env.EVENTS_FILE || path.join(__dirname, 'data', 'events.json');
const reportsFile =
  process.env.LITTER_REPORTS_FILE || path.join(__dirname, 'data', 'litter-reports.json');
const litterPickEventsFile =
  process.env.LITTER_PICK_EVENTS_FILE || path.join(__dirname, 'data', 'litter-pick-events.json');
const adminPassword = process.env.ADMIN_PASSWORD || 'H3Leaf';
const hethersettStreetViewBox = '1.12900,52.62980,1.23240,52.56600';
const nominatimCache = new Map();
const nominatimCacheMs = 12 * 60 * 60 * 1000;
let lastNominatimRequestAt = 0;

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

const ensureLitterPickEventsDir = async () => {
  const dir = path.dirname(litterPickEventsFile);
  await fs.mkdir(dir, { recursive: true });
};

const readLitterPickEvents = async () => {
  try {
    const raw = await fs.readFile(litterPickEventsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writeLitterPickEvents = async (events) => {
  await ensureLitterPickEventsDir();
  const tempFile = `${litterPickEventsFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(events, null, 2), 'utf-8');
  await fs.rename(tempFile, litterPickEventsFile);
};

const cleanString = (value, maxLength = 1000) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
};

const mapLinkFor = (lat, lng) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nominatimLimit = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 20)) : 20;
};

const streetSearchParams = (req) => {
  const rawQuery = cleanString(req.query.q, 220);
  if (!rawQuery) {
    return null;
  }

  return new URLSearchParams({
    format: 'jsonv2',
    q: rawQuery.toLowerCase().includes('hethersett')
      ? rawQuery
      : `${rawQuery}, Hethersett, Norfolk, United Kingdom`,
    addressdetails: '1',
    polygon_geojson: '1',
    countrycodes: 'gb',
    limit: String(nominatimLimit(req.query.limit)),
    dedupe: req.query.dedupe === '1' ? '1' : '0',
    bounded: '1',
    viewbox: hethersettStreetViewBox
  });
};

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
    state: 'new',
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
    const sortedReports = [...reports].sort((a, b) => {
      const stateComparison = (a.state === 'addressed' ? 1 : 0) - (b.state === 'addressed' ? 1 : 0);
      if (stateComparison !== 0) {
        return stateComparison;
      }

      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(sortedReports);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load litter reports' });
  }
});

app.put('/api/litter-reports/:id/state', requireAuth, async (req, res) => {
  const id = cleanString(req.params.id, 80);
  const state = req.body?.state === 'addressed' ? 'addressed' : 'new';

  try {
    const reports = await readReports();
    const reportIndex = reports.findIndex((report) => report.id === id);
    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Litter report not found' });
    }

    reports[reportIndex] = { ...reports[reportIndex], state };
    await writeReports(reports);
    return res.json(reports[reportIndex]);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update litter report' });
  }
});

app.delete('/api/litter-reports/:id', requireAuth, async (req, res) => {
  const id = cleanString(req.params.id, 80);

  try {
    const reports = await readReports();
    const updated = reports.filter((report) => report.id !== id);
    if (updated.length === reports.length) {
      return res.status(404).json({ error: 'Litter report not found' });
    }

    await writeReports(updated);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete litter report' });
  }
});

app.get('/api/street-search', async (req, res) => {
  const params = streetSearchParams(req);
  if (!params) {
    return res.status(400).json({ error: 'Street search query is required.' });
  }

  const key = params.toString();
  const cached = nominatimCache.get(key);
  if (cached && Date.now() - cached.cachedAt <= nominatimCacheMs) {
    res.type('application/json');
    return res.send(cached.json);
  }

  const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
  if (waitMs > 0) {
    await delay(waitMs);
  }

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${key}`, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://happyhealthyhethersett.org/',
        'User-Agent': 'HappyHealthyHethersett/1.0 (https://happyhealthyhethersett.org)'
      }
    });
    lastNominatimRequestAt = Date.now();
    const body = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Street search is unavailable right now.' });
    }

    nominatimCache.set(key, { cachedAt: Date.now(), json: body });
    res.type('application/json');
    return res.send(body);
  } catch (error) {
    return res.status(503).json({ error: 'Street search is unavailable right now.' });
  }
});

app.get('/api/litter-pick-events', requireAuth, async (_req, res) => {
  try {
    const events = await readLitterPickEvents();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(events);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load litter pick events' });
  }
});

app.get('/api/public/litter-pick-events', async (_req, res) => {
  try {
    const events = await readLitterPickEvents();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(events);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load litter pick events' });
  }
});

app.put('/api/litter-pick-events', requireAuth, async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid litter pick events payload' });
  }

  try {
    await writeLitterPickEvents(events);
    return res.json(events);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save litter pick events' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Events API listening on port ${port}`);
});
