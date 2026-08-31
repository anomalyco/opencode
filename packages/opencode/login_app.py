from flask import Flask, render_template_string, request, jsonify, session, redirect, url_for
import secrets
import hashlib
from functools import wraps

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

# In-memory storage (use a database in production)
users = {}
api_keys = {}

LOGIN_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Login</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; }
        input[type="text"], input[type="password"] { width: 100%; padding: 8px; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; }
        button:hover { background: #0056b3; }
        .error { color: red; margin-bottom: 10px; }
        .success { color: green; margin-bottom: 10px; }
    </style>
</head>
<body>
    <h2>Login</h2>
    {% if error %}<div class="error">{{ error }}</div>{% endif %}
    {% if success %}<div class="success">{{ success }}</div>{% endif %}
    <form method="POST" action="/login">
        <div class="form-group">
            <label>Username:</label>
            <input type="text" name="username" required>
        </div>
        <div class="form-group">
            <label>Password:</label>
            <input type="password" name="password" required>
        </div>
        <button type="submit">Login</button>
    </form>
    <p><a href="/register">Register</a></p>
</body>
</html>
"""

REGISTER_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Register</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; }
        input[type="text"], input[type="password"] { width: 100%; padding: 8px; box-sizing: border-box; }
        button { background: #28a745; color: white; padding: 10px 20px; border: none; cursor: pointer; }
        button:hover { background: #218838; }
        .error { color: red; margin-bottom: 10px; }
    </style>
</head>
<body>
    <h2>Register</h2>
    {% if error %}<div class="error">{{ error }}</div>{% endif %}
    <form method="POST" action="/register">
        <div class="form-group">
            <label>Username:</label>
            <input type="text" name="username" required>
        </div>
        <div class="form-group">
            <label>Password:</label>
            <input type="password" name="password" required>
        </div>
        <button type="submit">Register</button>
    </form>
    <p><a href="/">Back to Login</a></p>
</body>
</html>
"""

DASHBOARD_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .api-key { background: #f8f9fa; padding: 15px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 10px 0; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; margin-right: 10px; }
        button:hover { background: #0056b3; }
        .btn-danger { background: #dc3545; }
        .btn-danger:hover { background: #c82333; }
    </style>
</head>
<body>
    <h2>Welcome, {{ username }}</h2>
    <h3>Your API Key</h3>
    <div class="api-key">{{ api_key }}</div>
    <form method="POST" action="/regenerate-key" style="display:inline;">
        <button type="submit" onclick="return confirm('Regenerate API key? This will invalidate the current one.')">Regenerate Key</button>
    </form>
    <form method="POST" action="/logout" style="display:inline;">
        <button type="submit" class="btn-danger">Logout</button>
    </form>
</body>
</html>
"""

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def generate_api_key() -> str:
    return f"sk-{secrets.token_urlsafe(32)}"

def verify_api_key(api_key: str) -> str | None:
    for username, key in api_keys.items():
        if key == api_key:
            return username
    return None

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'username' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def api_key_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401
        api_key = auth_header[7:]
        username = verify_api_key(api_key)
        if not username:
            return jsonify({'error': 'Invalid API key'}), 401
        request.api_user = username
        return f(*args, **kwargs)
    return decorated

@app.route('/')
def index():
    if 'username' in session:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        hashed = hash_password(password)
        
        if username in users and users[username] == hashed:
            session['username'] = username
            if username not in api_keys:
                api_keys[username] = generate_api_key()
            return redirect(url_for('dashboard'))
        return render_template_string(LOGIN_TEMPLATE, error='Invalid credentials')
    return render_template_string(LOGIN_TEMPLATE)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        if username in users:
            return render_template_string(REGISTER_TEMPLATE, error='Username already exists')
        
        users[username] = hash_password(password)
        api_keys[username] = generate_api_key()
        session['username'] = username
        return redirect(url_for('dashboard'))
    return render_template_string(REGISTER_TEMPLATE)

@app.route('/dashboard')
@login_required
def dashboard():
    username = session['username']
    return render_template_string(DASHBOARD_TEMPLATE, username=username, api_key=api_keys[username])

@app.route('/regenerate-key', methods=['POST'])
@login_required
def regenerate_key():
    username = session['username']
    api_keys[username] = generate_api_key()
    return redirect(url_for('dashboard'))

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('login'))

# API endpoints
@app.route('/api/protected', methods=['GET'])
@api_key_required
def protected_endpoint():
    return jsonify({
        'message': 'Access granted',
        'user': request.api_user,
        'data': {'example': 'This is protected data'}
    })

@app.route('/api/public', methods=['GET'])
def public_endpoint():
    return jsonify({'message': 'Public endpoint - no authentication required'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)