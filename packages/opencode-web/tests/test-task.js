// Test script for opencode-web task system
const BASE_URL = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function registerOrLogin() {
  console.log('Registering or logging in...');
  
  // Try to login first with a test user
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'password123',
    }),
  });
  
  if (response.ok) {
    const data = await response.json();
    console.log('Login successful');
    return data.accessToken;
  } else {
    console.log('Login failed, attempting registration...');
    
    // Register a new test user
    const registerResponse = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
      }),
    });
    
    if (registerResponse.ok) {
      const data = await registerResponse.json();
      console.log('Registration successful');
      return data.accessToken;
    } else {
      console.error('Registration failed:', await registerResponse.text());
      return null;
    }
  }
}

async function createProject(token) {
  console.log('Creating a project...');
  
  const response = await fetch(`${BASE_URL}/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Test Project',
      description: 'A test project for task testing',
    }),
  });
  
  if (response.ok) {
    const data = await response.json();
    console.log('Project created:', data.project.id);
    return data.project.id;
  } else {
    console.error('Project creation failed:', await response.text());
    return null;
  }
}

async function createSession(token, projectId) {
  console.log('Creating a session...');
  
  const response = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      projectId: projectId,
      title: 'Test Session',
    }),
  });
  
  if (response.ok) {
    const data = await response.json();
    console.log('Session created:', data.session.id);
    return data.session.id;
  } else {
    console.error('Session creation failed:', await response.text());
    return null;
  }
}

async function startSession(token, sessionId) {
  console.log('Starting session container...');
  
  const response = await fetch(`${BASE_URL}/sessions/${sessionId}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });
  
  if (response.ok) {
    const data = await response.json();
    console.log('Session container started:', data.success);
    return data.success;
  } else {
    console.error('Session container start failed:', await response.text());
    return false;
  }
}

async function sendPrompt(token, sessionId) {
  console.log('Sending a prompt...');
  
  const response = await fetch(`${BASE_URL}/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      parts: [{
        type: 'text',
        content: 'Calculate the sum of 2 + 2 and respond with only the result.'
      }]
    }),
  });
  
  if (response.ok) {
    const data = await response.json();
    console.log('Prompt sent, task created:', data.taskId);
    return data.taskId;
  } else {
    console.error('Prompt sending failed:', await response.text());
    return null;
  }
}

async function monitorTask(token, taskId) {
  console.log('Monitoring task progress...');
  
  // We'll use the stream endpoint to monitor progress
  const response = await fetch(`${BASE_URL}/tasks/${taskId}/stream`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep last incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim(); // Remove 'data:' prefix
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                console.log('Task event:', data);
                
                // Check if task is completed
                if (data.event === 'completed' || data.event === 'failed') {
                  return data;
                }
              } catch (e) {
                console.error('Error parsing event data:', e);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  
  return null;
}

async function main() {
  console.log('Starting opencode-web task test...');
  
  // Step 1: Register or login
  const token = await registerOrLogin();
  if (!token) {
    console.error('Authentication failed');
    return;
  }
  
  console.log('Authenticated successfully with token:', token.substring(0, 20) + '...');
  
  // Step 2: Create a project
  const projectId = await createProject(token);
  if (!projectId) {
    console.error('Project creation failed');
    return;
  }
  
  // Step 3: Create a session
  const sessionId = await createSession(token, projectId);
  if (!sessionId) {
    console.error('Session creation failed');
    return;
  }
  
  // Step 4: Start the session container
  const containerStarted = await startSession(token, sessionId);
  if (!containerStarted) {
    console.error('Container start failed');
    return;
  }
  
  // Step 5: Send a prompt (this creates a task)
  const taskId = await sendPrompt(token, sessionId);
  if (!taskId) {
    console.error('Prompt sending failed');
    return;
  }
  
  // Step 6: Monitor the task
  console.log('Waiting for task completion...');
  const result = await monitorTask(token, taskId);
  
  if (result) {
    console.log('Task completed successfully');
  } else {
    console.log('Task monitoring ended without completion');
  }
  
  console.log('Test completed');
}

main().catch(console.error);