const express = require('express');
const sqlite3 = require('sqlite3');
const { exec } = require('child_process');
const fs = require('fs');
const session = require('express-session');
const multer = require('multer');
const { parseString } = require('xml2js');
const ejs = require('ejs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const app = express();
const upload = multer({ dest: 'public/uploads/' });
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const db = new sqlite3.Database('database.db');
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, balance INTEGER DEFAULT 0)");
  db.run("INSERT OR IGNORE INTO users (username, password, role, balance) VALUES ('admin', 'adminpass', 'admin', 1000000)");
  db.run("CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY, content_type TEXT, content_data TEXT)");
  db.run("INSERT OR IGNORE INTO content (id, content_type, content_data) VALUES (1, 'text', 'Default text. Hack me!')");
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: true, cookie: { httpOnly: false } }));
app.disable('x-powered-by');
app.use((err, req, res, next) => { res.status(500).send(err.stack); });
app.use('/public', express.static('public'));

app.get('/', (req, res) => {
  db.get("SELECT content_type, content_data FROM content WHERE id = 1", (err, row) => {
    let contentHtml = '';
    if (row) {
      if (row.content_type === 'text') contentHtml = `<div id="dynamic-content">${row.content_data}</div>`;
      else if (row.content_type === 'image') contentHtml = `<img src="${row.content_data}" style="max-width:500px">`;
      else if (row.content_type === 'video') contentHtml = `<video controls src="${row.content_data}" style="max-width:500px"></video>`;
      else if (row.content_type === 'gif') contentHtml = `<img src="${row.content_data}" style="max-width:500px">`;
    }
    let html = `
    <html>
    <head><title>Coin App</title><style>body{background:white;color:black;font-family:monospace;}</style></head>
    <body>
    <h1>Coin App</h1>
    ${req.session.user ? `<p>Welcome, ${req.session.user}</p><p>Balance: ${req.session.balance}</p>
    <form action="/add" method="POST"><button type="submit">+1 coin</button></form><br>
    <a href="/top">Top 3</a> <a href="/logout">Logout</a> <a href="/comment">Comment</a>
    <hr>
    <h2>Current site content (hackable)</h2>
    ${contentHtml}
    ` : `
    <h2>Register</h2>
    <form action="/register" method="POST">
      Username: <input name="username"><br>
      Password: <input type="password" name="password"><br>
      <button type="submit">Register</button>
    </form>
    <h2>Login</h2>
    <form action="/login" method="POST">
      Username: <input name="username"><br>
      Password: <input type="password" name="password"><br>
      <button type="submit">Login</button>
    </form>
    `}
    </body>
    </html>
    `;
    res.send(html);
  });
});

app.post('/register', (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  db.run(`INSERT INTO users (username, password) VALUES ('${username}', '${password}')`, (err) => {
    if (err) return res.send('Registration failed');
    res.redirect('/');
  });
});

app.post('/login', (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  db.get(`SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`, (err, row) => {
    if (err || !row) return res.send('Invalid login');
    req.session.user = row.username;
    req.session.userId = row.id;
    req.session.balance = row.balance;
    res.redirect('/');
  });
});

app.post('/add', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  let userId = req.session.userId;
  db.get(`SELECT balance FROM users WHERE id = ${userId}`, (err, row) => {
    let newBalance = row.balance + 1;
    db.run(`UPDATE users SET balance = ${newBalance} WHERE id = ${userId}`, () => {
      db.get(`SELECT balance FROM users WHERE id = ${userId}`, (err2, row2) => {
        req.session.balance = row2.balance;
        res.redirect('/');
      });
    });
  });
});

app.get('/top', (req, res) => {
  db.all(`SELECT username, balance FROM users ORDER BY balance DESC LIMIT 3`, (err, rows) => {
    let html = '<html><body bgcolor=white><h1>Top 3</h1><ul>';
    rows.forEach(r => { html += `<li>${r.username}: ${r.balance}</li>`; });
    html += '</ul><a href="/">Back</a></body></html>';
    res.send(html);
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ========== CONTENT HACKING ENDPOINTS ==========
app.post('/update-text', (req, res) => {
  let text = req.body.text;
  db.run(`UPDATE content SET content_type = 'text', content_data = '${text}' WHERE id = 1`, (err) => {
    res.send('Content updated');
  });
});

const mediaUpload = multer({ dest: 'public/uploads/' });
app.post('/upload-media', mediaUpload.single('media'), (req, res) => {
  let file = req.file;
  let mediaType = req.body.type || 'image';
  let url = `/public/uploads/${file.filename}`;
  db.run(`UPDATE content SET content_type = '${mediaType}', content_data = '${url}' WHERE id = 1`, (err) => {
    res.send(`Media uploaded: ${url}`);
  });
});
app.use('/uploads', express.static('public/uploads'));

// ========== SQL INJECTION (UNION, TIME-BASED, SECOND-ORDER) ==========
app.get('/user', (req, res) => {
  let id = req.query.id;
  db.get(`SELECT username, balance FROM users WHERE id = ${id}`, (err, row) => {
    if (err) res.send(err.message);
    else res.json(row);
  });
});
app.get('/user-time', (req, res) => {
  let id = req.query.id;
  db.get(`SELECT username FROM users WHERE id = ${id}`, (err, row) => { res.send(row || {}); });
});
app.post('/comment', (req, res) => {
  let text = req.body.text;
  db.run(`INSERT INTO comments (text) VALUES ('${text}')`, (err) => { res.send('ok'); });
});
app.get('/comments', (req, res) => {
  db.all(`SELECT * FROM comments`, (err, rows) => {
    let html = '<html><body bgcolor=white><ul>';
    rows.forEach(r => { html += `<li>${r.text}</li>`; });
    html += '</ul></body></html>';
    res.send(html);
  });
});
app.get('/search-comment', (req, res) => {
  let keyword = req.query.q;
  db.all(`SELECT * FROM comments WHERE text LIKE '%${keyword}%'`, (err, rows) => { res.json(rows); });
});

// ========== COMMAND INJECTION (RCE) ==========
app.get('/ping', (req, res) => {
  let ip = req.query.ip || '127.0.0.1';
  exec(`ping -c 1 ${ip}`, (err, stdout) => { res.send(`<pre>${stdout}</pre>`); });
});

// ========== RCE via 25+ languages ==========
const languages = {
  python: (code) => `python3 -c "${code.replace(/"/g, '\\"')}"`,
  ruby: (code) => `ruby -e "${code.replace(/"/g, '\\"')}"`,
  node: (code) => `node -e "${code.replace(/"/g, '\\"')}"`,
  php: (code) => `php -r "${code.replace(/"/g, '\\"')}"`,
  perl: (code) => `perl -e "${code.replace(/"/g, '\\"')}"`,
  bash: (code) => `bash -c "${code.replace(/"/g, '\\"')}"`,
  sh: (code) => `sh -c "${code.replace(/"/g, '\\"')}"`,
  zsh: (code) => `zsh -c "${code.replace(/"/g, '\\"')}"`,
  go: (code) => `go run -e "${code}"`,
  rust: (code) => `rustc -e "${code}"`,
  cpp: (code) => `echo '${code}' | g++ -x c++ - && ./a.out`,
  java: (code) => `echo '${code}' > Main.java && javac Main.java && java Main`,
  csharp: (code) => `echo '${code}' > script.cs && csc script.cs && mono script.exe`,
  lua: (code) => `lua -e "${code.replace(/"/g, '\\"')}"`,
  r: (code) => `R -e "${code.replace(/"/g, '\\"')}"`,
  julia: (code) => `julia -e "${code.replace(/"/g, '\\"')}"`,
  scala: (code) => `scala -e "${code.replace(/"/g, '\\"')}"`,
  kotlin: (code) => `kotlin -e "${code.replace(/"/g, '\\"')}"`,
  swift: (code) => `swift -e "${code.replace(/"/g, '\\"')}"`,
  tcl: (code) => `tclsh -c "${code.replace(/"/g, '\\"')}"`,
  awk: (code) => `awk '${code}'`,
  sed: (code) => `sed -e '${code}'`,
  groovy: (code) => `groovy -e "${code.replace(/"/g, '\\"')}"`,
  perl6: (code) => `perl6 -e "${code.replace(/"/g, '\\"')}"`,
  powershell: (code) => `powershell -Command "${code.replace(/"/g, '\\"')}"`
};
app.get('/exec', (req, res) => {
  let lang = req.query.lang;
  let code = req.query.code;
  if (!lang || !code || !languages[lang]) return res.send('invalid lang or code');
  let cmd = languages[lang](code);
  exec(cmd, (err, stdout, stderr) => { res.send(`<pre>${stdout || stderr || err}</pre>`); });
});

// ========== LFI / PATH TRAVERSAL ==========
app.get('/read', (req, res) => {
  let file = req.query.file || 'server.js';
  fs.readFile(file, 'utf8', (err, data) => { res.send(`<pre>${data || err}</pre>`); });
});

// ========== XSS (reflected, stored, DOM) ==========
app.get('/xss', (req, res) => { res.send(`<html><body>Hello ${req.query.name}</body></html>`); });

// ========== SSRF ==========
const axios = require('axios');
app.get('/fetch', async (req, res) => {
  let url = req.query.url;
  try { let r = await axios.get(url); res.send(r.data); } catch(e) { res.send(e.message); }
});

// ========== IDOR ==========
app.get('/setbalance', (req, res) => {
  let id = req.query.id;
  let amount = req.query.amount;
  db.run(`UPDATE users SET balance = ${amount} WHERE id = ${id}`, () => { res.send('done'); });
});

// ========== PROTOTYPE POLLUTION ==========
app.get('/pollute', (req, res) => {
  let key = req.query.key;
  let value = req.query.value;
  eval(`({}).__proto__['${key}'] = '${value}'`);
  res.send('polluted');
});

// ========== SSTI (EJS) ==========
app.set('view engine', 'ejs');
app.get('/template', (req, res) => {
  let tpl = req.query.template || '<%= name %>';
  let name = req.query.name || 'world';
  let html = ejs.render(tpl, { name: name }, { debug: true });
  res.send(html);
});

// ========== XXE ==========
app.post('/xml', (req, res) => {
  let xml = req.body.xml;
  parseString(xml, (err, result) => { if(err) res.send('XML parse error'); else res.json(result); });
});

// ========== JWT with none algorithm ==========
app.get('/jwt', (req, res) => {
  let token = jwt.sign({ user: 'guest', admin: false }, 'secret', { algorithm: 'HS256' });
  res.json({ token });
});
app.get('/jwt-admin', (req, res) => {
  let token = req.query.token;
  let decoded = jwt.verify(token, 'secret', { algorithms: ['HS256', 'none'] });
  if (decoded.admin) res.send('FLAG{jwt_none_algorithm}');
  else res.send('not admin');
});

// ========== WebSocket без проверки происхождения ==========
wss.on('connection', (ws, req) => {
  ws.on('message', (msg) => { try { eval(msg.toString()); } catch(e) {} });
});

// ========== ReDoS ==========
app.get('/redos', (req, res) => {
  let str = req.query.str || '';
  let re = /^(a+)+$/;
  if (re.test(str)) res.send('matched');
  else res.send('not matched');
});

// ========== CRLF Injection ==========
app.get('/redirect', (req, res) => {
  let url = req.query.url;
  res.setHeader('Location', url);
  res.status(302).send();
});

// ========== CORS misconfiguration ==========
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// ========== HTTP Parameter Pollution ==========
app.get('/hpp', (req, res) => { res.json({ param: req.query.param }); });

// ========== Open Redirect ==========
app.get('/go', (req, res) => { res.redirect(req.query.url); });

// ========== GraphQL with SQLi ==========
const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');
let schema = buildSchema(`type Query { user(id: Int): String }`);
let root = { user: ({ id }) => { return new Promise((resolve) => { db.get(`SELECT username FROM users WHERE id = ${id}`, (err, row) => { resolve(row ? row.username : null); }); }); } };
app.use('/graphql', graphqlHTTP({ schema, rootValue: root, graphiql: true }));

// ========== eval RCE ==========
app.get('/eval', (req, res) => {
  try { res.send(String(eval(req.query.code))); } catch(e) { res.send(e.toString()); }
});

// ========== Environment leak ==========
app.get('/env', (req, res) => { res.json(process.env); });

// ========== Unsafe file upload (already have media upload) ==========
app.post('/upload-any', upload.single('file'), (req, res) => { res.send(`/public/uploads/${req.file.filename}`); });

// ========== Cache poisoning ==========
app.get('/cache-me', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send('cached ' + Date.now());
});

// ========== Server-side prototype pollution (advanced) ==========
app.get('/pollute2', (req, res) => {
  let payload = JSON.parse(req.query.payload || '{}');
  Object.assign({}, payload);
  res.send('done');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on ${PORT}`));
