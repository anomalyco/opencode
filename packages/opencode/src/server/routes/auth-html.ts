export const HTML_LOGIN = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenCode Login</title>
    <style>
        :root {
            --font-family-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            
            /* Light theme variables (default) */
            --background-base: #f8f7f7;
            --background-strong: #fcfcfc;
            --surface-base: rgba(0, 0, 0, 0.05);
            --text-base: #6e6a6a;
            --text-strong: #151313;
            --text-weak: #8e8b8b;
            --primary: #dcde8d;
            --border: rgba(0, 0, 0, 0.1);
            --error: #fc533a;
            --button-text: #151313;
            --input-bg: rgba(0, 0, 0, 0.03);
            --input-border: rgba(0, 0, 0, 0.08);
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --background-base: #131010;
                --background-strong: #191515;
                --surface-base: rgba(255, 255, 255, 0.05);
                --text-base: #b1acaa;
                --text-strong: #f6f3f3;
                --text-weak: #716c6b;
                --primary: #fab283;
                --border: rgba(255, 255, 255, 0.1);
                --error: #fc533a;
                --button-text: #131010;
                --input-bg: rgba(255, 255, 255, 0.03);
                --input-border: rgba(255, 255, 255, 0.08);
                --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
            }
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--font-family-sans);
            background-color: var(--background-base);
            color: var(--text-base);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        .login-container {
            width: 100%;
            max-width: 360px;
            padding: 2.5rem;
            background-color: var(--background-strong);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: var(--shadow);
        }

        .header {
            margin-bottom: 2rem;
            text-align: center;
        }

        .logo {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
            color: var(--text-strong);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .logo svg {
            width: 24px;
            height: 24px;
            color: var(--text-strong);
        }

        .subtitle {
            color: var(--text-weak);
            font-size: 0.875rem;
        }

        .form-group {
            margin-bottom: 1rem;
        }

        label {
            display: block;
            margin-bottom: 0.375rem;
            font-size: 0.8125rem;
            font-weight: 500;
            color: var(--text-strong);
        }

        input {
            width: 100%;
            padding: 0.625rem 0.75rem;
            background-color: var(--input-bg);
            border: 1px solid var(--input-border);
            border-radius: 6px;
            color: var(--text-strong);
            font-size: 0.875rem;
            transition: all 0.15s ease;
            font-family: inherit;
        }

        input:focus {
            outline: none;
            border-color: var(--text-strong);
            background-color: var(--background-strong);
        }
        
        input::placeholder {
            color: var(--text-weak);
            opacity: 0.7;
        }

        button {
            width: 100%;
            padding: 0.625rem;
            background-color: var(--text-strong);
            color: var(--background-base);
            border: none;
            border-radius: 6px;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s ease;
            margin-top: 1rem;
            font-family: inherit;
        }

        button:hover {
            opacity: 0.9;
        }
        
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .error-message {
            color: var(--error);
            font-size: 0.8125rem;
            margin-top: 1rem;
            text-align: center;
            display: none;
            padding: 0.5rem;
            background-color: rgba(252, 83, 58, 0.1);
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="header">
            <div class="logo">
                <svg viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M24 32H8V16H24V32Z" fill="currentColor" fill-opacity="0.25"/>
                    <path d="M24 8H8V32H24V8ZM32 40H0V0H32V40Z" fill="currentColor"/>
                </svg>
                <span class="logo-text">OpenCode</span>
            </div>
        </div>
        <form id="loginForm">
            <div class="form-group">
                <input type="text" id="username" name="username" value="opencode" required autocomplete="username" placeholder="Enter username">
            </div>
            <div class="form-group">
                <input type="password" id="password" name="password" required autocomplete="current-password" autofocus placeholder="Enter password">
            </div>
            <button type="submit" id="submitBtn">Sign in</button>
            <div class="error-message" id="errorMessage">Invalid credentials</div>
        </form>
    </div>

    <script>
        const form = document.getElementById('loginForm');
        const errorMsg = document.getElementById('errorMessage');
        const submitBtn = document.getElementById('submitBtn');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorMsg.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying...';

            const username = form.username.value;
            const password = form.password.value;
            const credentials = btoa(username + ':' + password);

            try {
                const response = await fetch('/auth/verify', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Basic ' + credentials,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    // Redirect to home or original destination
                    const urlParams = new URLSearchParams(window.location.search);
                    const redirect = urlParams.get('redirect') || '/';
                    window.location.href = redirect;
                } else {
                    errorMsg.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign in';
                }
            } catch (err) {
                console.error('Login error:', err);
                errorMsg.textContent = 'Connection failed';
                errorMsg.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in';
            }
        });
    </script>
</body>
</html>`