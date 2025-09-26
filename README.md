
 # Pitch

👉 “OAuth was built for humans authorizing apps. AI agents don’t have a security layer today — they can act unpredictably. We’re building a ‘security broker for AI agents’ that gives humans real-time control and visibility into agent actions.”

## In AI we call it Human in the loop situation,  [ Read more about our Human in the loop in AI](https://www.ibm.com/think/topics/human-in-the-loop)

### 1. **Product Concept**

Think of it like a **“Just-in-Time AI Agent Access Gateway”**.

* Whenever an AI agent wants to perform a sensitive action (read a file, send an email, modify a calendar event, move money, etc.), it goes through your system.
* Your system holds the *policy + approvals* (like a proxy between the AI and resources).
* You, the human, are “in the loop” via real-time approval prompts — on mobile, web, or desktop.

![poc](/assets/hitl.png)

### 2. **Key Components**

1. **Policy Engine**

   * Rules that define what needs approval and what doesn’t.
   * Example: “AI can read my calendar without asking, but must ask before sending an invite.”

2. **Action Interceptor**

   * Like a middleware layer between AI and APIs/resources.
   * Every action is logged and routed through your service.

3. **Human-in-the-Loop Notifier**

   * Mobile app / push notification: “Your AI agent wants to open `personal/tax2024.pdf`. Approve or deny?”
   * You can add contextual info: *why* the AI is requesting it (explainable AI bit).

4. **Audit Trail / Logs**

   * Keeps a tamper-proof record of all agent requests, approvals, denials.



### 3. **User Flow Example**

1. AI Agent → “Need access to `resume.docx`”
2. Gateway intercepts → Pushes prompt to user’s mobile.
3. User taps **Approve** → Agent continues.
4. User taps **Reject** → Agent gets a “denied” error.



### 4. **Hackathon Scope (MVP)**

You don’t need to build the full infra. For a hackathon, show:

* A simple **mock AI agent** (say, a script that tries to read a Google Drive file).
* Your **gateway service** (middleware that intercepts and requires approval).
* A **mobile/web app UI** where the user gets notified and approves/denies.
* Bonus: Add simple **policies** like “auto-approve access to /public, always prompt for /private.”


## 🔐 High-Level Architecture

```
+-----------------------------+
|        User Mobile App      |
|  (Approve / Reject prompt)  |
+-------------+---------------+
              |
              v
+-----------------------------+
|   Control Gateway Service   |
|  - AuthN / AuthZ            |
|  - Policy Engine            |
|  - Request Queue             |
|  - Audit / Logging           |
+------+------+---------------+
       |      |
       |      v
       |  +-------------------+
       |  | Notification Svc  |
       |  | (push/email/etc.) |
       |  +-------------------+
       |
       v
+-----------------------------+
|    AI Agent Interceptor     |
|  (Middleware SDK / Proxy)   |
+-------------+---------------+
              |
              v
+-----------------------------+
|      Resource APIs/Files    |
| (Drive, Mail, DB, Cloud FS) |
+-----------------------------+
```

---

## 🧩 Components Breakdown

1. **AI Agent Interceptor (SDK or Proxy)**

   * Wraps the AI agent’s API calls (file read, send email, etc.).
   * Every “sensitive action” is routed to the **Control Gateway** first.
   * Could be an SDK the agent uses, or a network proxy.

2. **Control Gateway Service**

   * **AuthN / AuthZ**: Identifies which agent is requesting what, on behalf of which user.
   * **Policy Engine**: Checks pre-defined rules (e.g., auto-allow reading calendar, but prompt for files in `/confidential`).
   * **Request Queue**: Stores pending approval requests.
   * **Audit Logs**: Immutable log for every attempted action.

3. **Notification Service**

   * Pushes real-time approval requests to the user’s mobile app/web.
   * Could use Firebase Cloud Messaging, Apple Push Notification Service, or WebSockets.

4. **User Mobile/Web App**

   * Shows contextual info:

     * “AI agent X wants to read `tax2024.pdf` because: [agent’s reasoning/explanation].”
   * User taps Approve/Reject → sends response back to Gateway.

5. **Resource APIs/Files**

   * Once approved, Gateway releases a signed access token (like OAuth-style short-lived credential) to the agent to complete the action.
   * If rejected, the agent gets a denial response.


## 🔧 Quick MVP Suggestion

* **Agent**: Simple Python script pretending to read a Google Drive file.
* **Gateway**: Node.js/Express or Flask service with in-memory queue + SQLite for audit logs.
* **Notification**: Firebase push notifications.
* **User App**: Very lightweight React web app or mobile app (Expo/React Native).
* **Policy Engine**: Hardcoded JSON rules (`/public` = auto, `/private` = require approval).
