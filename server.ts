import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helpers for data persistence
function readJSONFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return fallback;
  }
}

function writeJSONFile<T>(filePath: string, data: T): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// ---------------- GLOBAL CLOUD DATABASE SYNC FOR SERVER ----------------
const CLOUD_API_BASE = 'https://extendsclass.com/api/json-storage/bin';
const CLOUD_USERS_ID = 'cedddeb';
const CLOUD_MESSAGES_ID = 'aacedba';
const CLOUD_ACTIVITIES_ID = 'caefdcc';

async function fetchFromCloudServer<T>(objectId: string, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${CLOUD_API_BASE}/${objectId}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const json = (await res.json()) as any;
    return (json as T) || fallback;
  } catch {
    clearTimeout(timer);
    return fallback;
  }
}

async function putToCloudServer(objectId: string, _name: string, data: any): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${CLOUD_API_BASE}/${objectId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export async function syncServerWithCloud(): Promise<void> {
  try {
    const [cloudUsersData, cloudMsgsData, cloudActsData] = await Promise.all([
      fetchFromCloudServer<{ users: any[] }>(CLOUD_USERS_ID, { users: [] }),
      fetchFromCloudServer<{ messages: any[] }>(CLOUD_MESSAGES_ID, { messages: [] }),
      fetchFromCloudServer<{ activities: any[] }>(CLOUD_ACTIVITIES_ID, { activities: [] }),
    ]);

    // 1. Sync users bi-directionally
    const localUsers = readJSONFile<Record<string, any>>(USERS_FILE, {});
    let usersModified = false;

    if (Array.isArray(cloudUsersData.users)) {
      cloudUsersData.users.forEach((cu: any) => {
        const u = cu.username?.toLowerCase();
        if (u && !localUsers[u]) {
          localUsers[u] = {
            id: cu.id || u,
            username: cu.username,
            displayName: cu.displayName || cu.username,
            password: cu.password || 'password123',
            createdAt: cu.createdAt || '2026-09-01',
            level: cu.level || 'beginner',
            goal: cu.goal || 'hypertrophy',
            weightKg: cu.weightKg || 75,
            heightCm: cu.heightCm || 175,
            completedWorkoutsCount: cu.completedWorkoutsCount || 0,
            isAdmin: Boolean(cu.isAdmin),
          };
          usersModified = true;
        }
      });
    }

    if (usersModified) {
      writeJSONFile(USERS_FILE, localUsers);
    }

    const cloudUsernames = new Set((cloudUsersData.users || []).map((u: any) => u.username?.toLowerCase()));
    const missingInCloud = Object.values(localUsers).filter((lu) => !cloudUsernames.has(lu.username.toLowerCase()));
    if (missingInCloud.length > 0) {
      const mergedCloudUsers = [...(cloudUsersData.users || []), ...missingInCloud];
      await putToCloudServer(CLOUD_USERS_ID, 'YOUR_FITNESS_GLOBAL_USERS_V1', { users: mergedCloudUsers });
    }

    // 2. Sync messages bi-directionally
    const localMessages = readJSONFile<any[]>(MESSAGES_FILE, []);
    const msgMap = new Map<string, any>();
    localMessages.forEach((m) => msgMap.set(m.id, m));
    if (Array.isArray(cloudMsgsData.messages)) {
      cloudMsgsData.messages.forEach((m: any) => msgMap.set(m.id, m));
    }
    const mergedMsgs = Array.from(msgMap.values()).sort(
      (a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')
    );
    if (mergedMsgs.length > localMessages.length) {
      writeJSONFile(MESSAGES_FILE, mergedMsgs);
    }
    if (Array.isArray(cloudMsgsData.messages) && mergedMsgs.length > cloudMsgsData.messages.length) {
      await putToCloudServer(CLOUD_MESSAGES_ID, 'YOUR_FITNESS_GLOBAL_MESSAGES_V1', { messages: mergedMsgs });
    }

    // 3. Sync activities bi-directionally
    const localActivities = readJSONFile<any[]>(ACTIVITIES_FILE, []);
    const actMap = new Map<string, any>();
    localActivities.forEach((a) => actMap.set(a.id, a));
    if (Array.isArray(cloudActsData.activities)) {
      cloudActsData.activities.forEach((a: any) => actMap.set(a.id, a));
    }
    const mergedActs = Array.from(actMap.values()).sort(
      (a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')
    );
    if (mergedActs.length > localActivities.length) {
      writeJSONFile(ACTIVITIES_FILE, mergedActs.slice(0, 99));
    }
    if (Array.isArray(cloudActsData.activities) && mergedActs.length > cloudActsData.activities.length) {
      await putToCloudServer(CLOUD_ACTIVITIES_ID, 'YOUR_FITNESS_GLOBAL_ACTIVITIES_V1', {
        activities: mergedActs.slice(0, 99),
      });
    }
  } catch (err) {
    console.warn('[Server Cloud Sync] Error:', err);
  }
}

// Pre-seed default accounts in users.json if not present
function initializeUsersFile(): void {
  const users = readJSONFile<Record<string, any>>(USERS_FILE, {});
  let modified = false;

  if (!users['marcus_vance']) {
    users['marcus_vance'] = {
      id: 'marcus_vance',
      username: 'marcus_vance',
      displayName: 'Marcus Vance',
      password: 'password123',
      createdAt: '2026-08-01',
      level: 'intermediate',
      goal: 'hypertrophy',
      weightKg: 81.4,
      heightCm: 180,
      completedWorkoutsCount: 5,
    };
    modified = true;
  }

  // Ensure Admin account is registered with strict password
  users['admin'] = {
    id: 'admin',
    username: 'Admin',
    displayName: 'Platform Administrator',
    password: 'Arpit@dev8462',
    createdAt: '2026-09-01',
    level: 'advanced',
    goal: 'strength',
    weightKg: 70.0,
    heightCm: 175,
    isAdmin: true,
    completedWorkoutsCount: 12,
  };
  modified = true;

  // Clean legacy arpit_yadav demo account if present
  if (users['arpit_yadav']) {
    delete users['arpit_yadav'];
    modified = true;
  }

  if (modified) {
    writeJSONFile(USERS_FILE, users);
  }
}

initializeUsersFile();

export async function createServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // Enable CORS for external access across devices and Netlify deployments
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'YOUR FITNESS Server',
      serverTime: new Date().toISOString(),
      timestamp: Date.now(),
    });
  });

  // ---------------- MESSAGES API (Global sync across all devices) ----------------
  app.get('/api/messages', (_req, res) => {
    const messages = readJSONFile(MESSAGES_FILE, []);
    res.json({ success: true, messages });
  });

  app.post('/api/messages', (req, res) => {
    try {
      const { senderName, message, senderEmail } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Message content is required' });
      }

      const messages = readJSONFile(MESSAGES_FILE, []);
      const now = new Date();
      const formattedTime = `${now.toISOString().split('T')[0]} ${now
        .getHours()
        .toString()
        .padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const newMsg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        senderName: (senderName && senderName.trim()) || 'Anonymous User',
        senderEmail: (senderEmail && senderEmail.trim()) || undefined,
        message: message.trim(),
        timestamp: formattedTime,
        read: false,
      };

      // Add to front of array
      const updatedMessages = [newMsg, ...messages];
      writeJSONFile(MESSAGES_FILE, updatedMessages);

      // Also log an activity event for admin dashboard
      const activities = readJSONFile(ACTIVITIES_FILE, []);
      const newActivity = {
        id: `act-${Date.now()}`,
        type: 'message',
        userName: newMsg.senderName,
        userId: newMsg.senderEmail || 'visitor',
        description: `User "${newMsg.senderName}" sent a new feedback message: "${newMsg.message.substring(0, 50)}..."`,
        timestamp: formattedTime,
      };
      writeJSONFile(ACTIVITIES_FILE, [newActivity, ...activities.slice(0, 99)]);

      console.log(`[MESSAGE RECEIVED] From: ${newMsg.senderName} (${newMsg.senderEmail || 'No Email'}) | Body: ${newMsg.message}`);

      // Sync to cloud in background
      syncServerWithCloud().catch(() => {});

      return res.status(201).json({ success: true, message: newMsg });
    } catch (err: any) {
      console.error('Error posting message:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    }
  });

  app.patch('/api/messages/:id/read', (req, res) => {
    try {
      const { id } = req.params;
      const messages = readJSONFile<any[]>(MESSAGES_FILE, []);
      const updated = messages.map((m) => (m.id === id ? { ...m, read: true } : m));
      writeJSONFile(MESSAGES_FILE, updated);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/messages/:id', (req, res) => {
    try {
      const { id } = req.params;
      const messages = readJSONFile<any[]>(MESSAGES_FILE, []);
      const updated = messages.filter((m) => m.id !== id);
      writeJSONFile(MESSAGES_FILE, updated);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------- USER ACTIVITIES API ----------------
  app.get('/api/activities', (_req, res) => {
    const activities = readJSONFile(ACTIVITIES_FILE, []);
    res.json({ success: true, activities });
  });

  app.post('/api/activities', (req, res) => {
    try {
      const { type, userName, userId, description } = req.body;
      const activities = readJSONFile<any[]>(ACTIVITIES_FILE, []);
      const now = new Date();
      const formattedTime = `${now.toISOString().split('T')[0]} ${now
        .getHours()
        .toString()
        .padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const newAct = {
        id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: type || 'workout',
        userName: userName || 'Athlete',
        userId: userId || 'user',
        description: description || 'Logged training activity',
        timestamp: formattedTime,
      };

      const updated = [newAct, ...activities.slice(0, 99)];
      writeJSONFile(ACTIVITIES_FILE, updated);
      res.status(201).json({ success: true, activity: newAct });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------- USER REGISTRATIONS & ACCOUNTS API ----------------
  // Get all registered users (for admin dashboard and user directory)
  app.get('/api/users', (_req, res) => {
    try {
      const users = readJSONFile<Record<string, any>>(USERS_FILE, {});
      const safeList = Object.values(users).map((u) => {
        const weight = u.weightKg || 75;
        const height = u.heightCm || 175;
        const bmi = Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10;
        let bmiCategory = 'Normal';
        if (bmi < 18.5) bmiCategory = 'Underweight';
        else if (bmi < 25) bmiCategory = 'Normal';
        else if (bmi < 30) bmiCategory = 'Overweight';
        else bmiCategory = 'Obese';

        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName || u.username,
          createdAt: u.createdAt || new Date().toISOString().split('T')[0],
          level: u.level || 'beginner',
          goal: u.goal || 'hypertrophy',
          completedWorkoutsCount: u.completedWorkoutsCount || 0,
          weightKg: weight,
          heightCm: height,
          bmi,
          bmiCategory,
          isAdmin: Boolean(u.isAdmin),
        };
      });
      res.json({ success: true, users: safeList });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Register new user globally across all devices
  app.post('/api/register', (req, res) => {
    try {
      const { username, password, displayName, level, goal, weightKg, heightCm } = req.body;
      const trimmedUser = (username || '').trim().toLowerCase();
      const trimmedPass = (password || '').trim();

      if (!trimmedUser) {
        return res.status(400).json({ success: false, error: 'User ID cannot be empty' });
      }
      if (trimmedUser === 'admin' || trimmedUser === 'administrator') {
        return res.status(400).json({ success: false, error: 'User ID "Admin" is reserved for the system administrator.' });
      }
      if (trimmedUser.length < 3) {
        return res.status(400).json({ success: false, error: 'User ID must be at least 3 characters' });
      }
      if (!trimmedPass || trimmedPass.length < 4) {
        return res.status(400).json({ success: false, error: 'Password must be at least 4 characters' });
      }

      const users = readJSONFile<Record<string, any>>(USERS_FILE, {});
      if (users[trimmedUser]) {
        return res.status(400).json({ success: false, error: `User ID "@${trimmedUser}" is already taken.` });
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const validWeight = parseFloat(weightKg) || 75;
      const validHeight = parseFloat(heightCm) || 175;

      const newAccount = {
        id: trimmedUser,
        username: trimmedUser,
        displayName: (displayName && displayName.trim()) || trimmedUser,
        password: trimmedPass,
        createdAt: todayStr,
        level: level || 'beginner',
        goal: goal || 'hypertrophy',
        weightKg: validWeight,
        heightCm: validHeight,
        completedWorkoutsCount: 0,
        isAdmin: false,
      };

      users[trimmedUser] = newAccount;
      writeJSONFile(USERS_FILE, users);

      // Automatically register a live activity
      const activities = readJSONFile<any[]>(ACTIVITIES_FILE, []);
      const now = new Date();
      const formattedTime = `${now.toISOString().split('T')[0]} ${now
        .getHours()
        .toString()
        .padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const regActivity = {
        id: `act-reg-${Date.now()}`,
        type: 'registration',
        userName: newAccount.displayName,
        userId: newAccount.username,
        description: `New athlete registered User ID @${newAccount.username} (${newAccount.level} level, ${newAccount.goal})`,
        timestamp: formattedTime,
      };
      writeJSONFile(ACTIVITIES_FILE, [regActivity, ...activities.slice(0, 99)]);

      console.log(`[USER REGISTERED] User: @${newAccount.username} | Name: ${newAccount.displayName}`);

      // Sync to cloud in background
      syncServerWithCloud().catch(() => {});

      res.status(201).json({ success: true, account: newAccount });
    } catch (err: any) {
      console.error('Registration error:', err);
      res.status(500).json({ success: false, error: err.message || 'Server error during registration' });
    }
  });

  // Login verification across devices
  app.post('/api/login', (req, res) => {
    try {
      const { username, password } = req.body;
      const trimmedUser = (username || '').trim().toLowerCase();
      const trimmedPass = (password || '').trim();

      const users = readJSONFile<Record<string, any>>(USERS_FILE, {});
      const found = users[trimmedUser];

      if (!found) {
        return res.status(404).json({ success: false, error: `No account found with User ID "@${trimmedUser}"` });
      }

      if (found.password !== trimmedPass) {
        return res.status(401).json({ success: false, error: 'Incorrect password. Please try again.' });
      }

      res.json({
        success: true,
        account: {
          id: found.id,
          username: found.username,
          displayName: found.displayName,
          level: found.level,
          goal: found.goal,
          weightKg: found.weightKg,
          heightCm: found.heightCm,
          isAdmin: Boolean(found.isAdmin),
          createdAt: found.createdAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Consolidated real-time sync endpoint for instant updates
  app.get('/api/sync', (_req, res) => {
    try {
      const messages = readJSONFile<any[]>(MESSAGES_FILE, []);
      const activities = readJSONFile<any[]>(ACTIVITIES_FILE, []);
      const users = readJSONFile<Record<string, any>>(USERS_FILE, {});
      const safeUsers = Object.values(users).map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName || u.username,
        createdAt: u.createdAt,
        level: u.level || 'beginner',
        goal: u.goal || 'hypertrophy',
        weightKg: u.weightKg || 75,
        heightCm: u.heightCm || 175,
        completedWorkoutsCount: u.completedWorkoutsCount || 0,
        isAdmin: Boolean(u.isAdmin),
      }));

      res.json({
        success: true,
        messages,
        activities,
        users: safeUsers,
        unreadCount: messages.filter((m) => !m.read).length,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------- Vite Middleware or Static Production ----------------
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YOUR FITNESS Server running at http://0.0.0.0:${PORT}`);
    // Run initial cloud sync on server boot
    syncServerWithCloud().then(() => {
      console.log('✅ Server initial cloud sync completed');
    }).catch(() => {});

    // Periodic cloud store sync every 25 seconds
    setInterval(() => {
      syncServerWithCloud().catch(() => {});
    }, 25000);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
