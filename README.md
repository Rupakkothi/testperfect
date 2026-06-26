# ✦ TestPerfect: Secure Proctoring & Coding Examination Platform

A premium, secure online examination platform featuring real-time webcam and microphone proctoring, browser focus tracking, and a sandboxed multi-language programming compiler (C, C++, Python, Java) powered by Judge0 CE.

---

## Key Features

1. **🔒 Secure Proctoring Console**:
   - **Webcam Monitor**: Live camera stream mirrored in the corner. Tracks camera access status.
   - **Microphone Audio Monitor**: Analyzes audio levels via browser AudioContext. Flags loud speech or noises exceeding volume thresholds.
   - **Tab Focus Tracker**: Detects when candidates switch tabs, minimize windows, or lose focus. Displays immediate warnings and auto-submits exams after 3 focus-loss violations.
   - **Fullscreen Enforcement**: Requests full-screen mode on exam initialization and logs exits.

2. **📝 Integrated Test Creator (Educator)**:
   - **MCQ Builder**: Define multiple-choice options and specify correct keys.
   - **Coding Sandbox Builder**: Support C, C++, Python, and Java. Educators can assign weightage (marks) and append **sample test cases** (visible to students) and **hidden test cases** (evaluated silently on exam submission).
   - **Submissions & Violation Review**: Deep-dive into candidates' grades, examine submitted code files, and review exact timestamped violation logs (tab switches, microphone alerts, webcam locks).

3. **💻 Sandboxed Compiler (Judge0 CE)**:
   - Real-time compiler outputs (stdout, stderr, compilation warnings, run duration) without needing local compilers installed.

---

## Project Structure

```
/test-platform
├── package.json         # Monorepo task configurations
├── README.md            # Comprehensive documentation
├── server/
│   ├── package.json     # Express dependencies
│   ├── server.js        # Main API endpoints (auth, exams, Judge0 proxy)
│   ├── db.js            # File-based JSON database engine
│   └── data/
│       └── db.json      # Persistent DB storage
└── client/
    ├── package.json     # Vite React dependencies
    ├── index.html       # Entry template & SEO meta
    └── src/
        ├── main.jsx
        ├── App.jsx      # Portal router, layouts, dashboards, and logic
        ├── index.css    # Premium glassmorphism design system
        ├── components/
        │   ├── WebcamFeed.jsx  # Media stream handler & audio analyzer
        │   └── CodeEditor.jsx  # Monospace textarea editor (supports Tab key spaces)
        └── utils/
            └── api.js   # Fetch request wrappers & dynamic API address resolvers
```

---

## Getting Started: Local Setup

### 1. Install Dependencies
Run the installation scripts from the root directory:
```bash
# Install server packages
npm run install:server

# Install client packages
npm run install:client
```

### 2. Run the Platform
Start the frontend and backend in separate terminal terminals:
```bash
# Terminal 1: Run Express Server (Starts on http://localhost:5000)
npm run start:server

# Terminal 2: Run Vite Dev Client (Starts on http://localhost:5173)
npm run start:client
```
Open **`http://localhost:5173`** in your browser.

---

## 🌐 Running Outside Localhost (Free SSL Tunneling)

Since web browsers restrict camera and microphone access to secure HTTPS contexts, you **cannot** access these features on other local network devices (like a mobile phone or another computer) using plain HTTP IP addresses (e.g., `http://192.168.1.50`).

To test the webcam and mic functionality on other devices without deploying to the cloud, you can use **Localtunnel** to instantly expose your local server with free, secure HTTPS urls.

### Step 1: Tunnel the Backend API
In a new terminal window, expose the Express server (port 5000):
```bash
npx localtunnel --port 5000
```
This will print a public URL, for example: `https://shady-waves-run.loca.lt`

### Step 2: Tunnel the Frontend Client
In another terminal window, expose the Vite client (port 5173):
```bash
npx localtunnel --port 5173
```
This will print another public URL, for example: `https://cool-mice-jump.loca.lt`

### Step 3: Link them together on your device
1. Open the frontend tunnel link (e.g., `https://cool-mice-jump.loca.lt`) on your phone or remote testing machine.
2. In the Login screen, scroll to the **API Endpoint URL** section at the bottom.
3. Paste your backend tunnel link (e.g., `https://shady-waves-run.loca.lt`) and click **Apply**.
4. The application is now fully linked! You can sign up, create tests, stream video, and compile code directly from any mobile phone or external device with fully working camera/mic permissions.

---

## 🚀 Permanent Production Cloud Deployment

To launch this application permanently in the cloud, you can deploy the frontend to **Vercel** and the backend to **Render** for free:

### 1. Backend Server Deployment (Render)
1. Push the `/server` directory (or the whole repo) to GitHub.
2. Log into [Render Dashboard](https://dashboard.render.com/) and create a new **Web Service**.
3. Link your GitHub repository.
4. Set the following details:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Deploy**. Render will provide a public HTTPS URL (e.g., `https://my-exam-backend.onrender.com`).

### 2. Frontend Client Deployment (Vercel)
1. Log into [Vercel Dashboard](https://vercel.com/) and click **Add New Project**.
2. Link your GitHub repository.
3. In the configuration panel:
   - **Root Directory**: `client`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Expand **Environment Variables** and add:
   - Key: `VITE_API_URL`
   - Value: `https://my-exam-backend.onrender.com` (Your Render backend URL)
5. Click **Deploy**. Vercel will launch your live site with full HTTPS proctoring enabled.

---

## 🔄 Running the Server Continuously ("Live Always")

If you want the server to run continuously (e.g. on your local computer, a home server, or a Windows Server VPS) in the background without needing an open terminal window, and you want it to **automatically restart if it crashes or the computer restarts**, you should use **PM2** (Process Manager 2).

### Step 1: Install PM2 Globally
Open a Command Prompt or PowerShell window as Administrator and run:
```bash
npm install -g pm2
```
*Note: If you run into PowerShell execution policies on Windows, run the command in a standard Command Prompt (cmd) instead.*

### Step 2: Start your Backend Server with PM2
Navigate to the `/server` folder and run:
```bash
pm2 start server.js --name "proctor-backend"
```
This launches the server in the background. You can now close your terminal window.

### Step 3: Useful PM2 Commands for Management
- **Check Server Status**: `pm2 status` or `pm2 list`
- **View Real-time Logs**: `pm2 logs proctor-backend`
- **Restart the Server**: `pm2 restart proctor-backend`
- **Stop the Server**: `pm2 stop proctor-backend`
- **Monitor RAM/CPU Usage**: `pm2 monit`

### Step 4: Make PM2 Start Automatically on Windows Startup
To ensure the server starts automatically whenever your computer restarts:
1. Install the Windows Startup service helper:
   ```bash
   npm install -g pm2-windows-startup
   ```
2. Setup the startup utility:
   ```bash
   pm2-startup install
   ```
3. Save your current PM2 running process list:
   ```bash
   pm2 save
   ```
Now, even if your machine rebooted or updated overnight, your backend server will automatically start and be available.

