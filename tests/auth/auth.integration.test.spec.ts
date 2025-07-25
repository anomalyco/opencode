/**
 * Authentication Module - Integration Test Specifications
 * Testing authentication flows with database, cache, and middleware integration
 */

describe('Authentication Integration Tests', () => {
  
  // Test Database Setup
  let testDb;
  let testCache;
  let testMailer;
  
  beforeAll(async () => {
    testDb = await setupTestDatabase();
    testCache = await setupTestCache();
    testMailer = setupMailerMock();
  });
  
  afterAll(async () => {
    await testDb.close();
    await testCache.close();
  });
  
  beforeEach(async () => {
    await testDb.clean();
    await testCache.flush();
    testMailer.reset();
  });

  describe('User Registration Flow', () => {
    it('should successfully register a new user', async () => {
      // Arrange
      const registrationData = {
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe'
      };
      
      // Act
      const result = await authService.register(registrationData);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user.id).toBeDefined();
      expect(result.user.email).toBe(registrationData.email);
      expect(result.user.password).toBeUndefined(); // Password should not be returned
      
      // Verify database record
      const dbUser = await testDb.users.findByEmail(registrationData.email);
      expect(dbUser).toBeDefined();
      expect(dbUser.passwordHash).toBeDefined();
      expect(dbUser.passwordHash).not.toBe(registrationData.password);
      
      // Verify verification email sent
      expect(testMailer.sentEmails).toHaveLength(1);
      expect(testMailer.sentEmails[0].to).toBe(registrationData.email);
      expect(testMailer.sentEmails[0].subject).toContain('Verify your email');
    });

    it('should reject duplicate email registration', async () => {
      // Arrange
      const email = 'existing@example.com';
      await testDb.users.create({
        email,
        passwordHash: 'existing-hash',
        firstName: 'Existing',
        lastName: 'User'
      });
      
      const registrationData = {
        email,
        password: 'NewPass123!',
        firstName: 'New',
        lastName: 'User'
      };
      
      // Act & Assert
      await expect(authService.register(registrationData))
        .rejects.toThrow('Email already registered');
      
      // Verify no additional email sent
      expect(testMailer.sentEmails).toHaveLength(0);
    });

    it('should handle database transaction rollback on error', async () => {
      // Arrange
      const registrationData = {
        email: 'transactiontest@example.com',
        password: 'SecurePass123!',
        firstName: 'Transaction',
        lastName: 'Test'
      };
      
      // Mock profile creation to fail
      jest.spyOn(testDb.profiles, 'create').mockRejectedValueOnce(new Error('Profile creation failed'));
      
      // Act & Assert
      await expect(authService.register(registrationData))
        .rejects.toThrow('Profile creation failed');
      
      // Verify user was not created due to rollback
      const user = await testDb.users.findByEmail(registrationData.email);
      expect(user).toBeNull();
    });

    it('should enforce rate limiting on registration attempts', async () => {
      // Arrange
      const ipAddress = '192.168.1.100';
      const registrationAttempts = 6; // Assuming limit is 5
      
      // Act - Make multiple registration attempts
      for (let i = 0; i < registrationAttempts; i++) {
        const registrationData = {
          email: `user${i}@example.com`,
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: `User${i}`
        };
        
        if (i < 5) {
          await authService.register(registrationData, { ipAddress });
        } else {
          // Assert - 6th attempt should be rate limited
          await expect(authService.register(registrationData, { ipAddress }))
            .rejects.toThrow('Too many registration attempts. Please try again later.');
        }
      }
    });

    it('should sanitize user input to prevent XSS', async () => {
      // Arrange
      const registrationData = {
        email: 'xsstest@example.com',
        password: 'SecurePass123!',
        firstName: '<script>alert("XSS")</script>John',
        lastName: 'Doe<img src=x onerror=alert("XSS")>'
      };
      
      // Act
      const result = await authService.register(registrationData);
      
      // Assert
      const dbUser = await testDb.users.findById(result.user.id);
      expect(dbUser.firstName).toBe('John'); // Script tags removed
      expect(dbUser.lastName).toBe('Doe'); // IMG tag removed
      expect(dbUser.firstName).not.toContain('<script>');
      expect(dbUser.lastName).not.toContain('<img');
    });
  });

  describe('User Login Flow', () => {
    beforeEach(async () => {
      // Setup test user
      const passwordHash = await hashPassword('TestPass123!');
      await testDb.users.create({
        id: 'test-user-id',
        email: 'testuser@example.com',
        passwordHash,
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true,
        isActive: true
      });
    });

    it('should successfully login with valid credentials', async () => {
      // Arrange
      const loginData = {
        email: 'testuser@example.com',
        password: 'TestPass123!'
      };
      
      // Act
      const result = await authService.login(loginData);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(loginData.email);
      
      // Verify session created in database
      const session = await testDb.sessions.findByUserId(result.user.id);
      expect(session).toBeDefined();
      expect(session.isActive).toBe(true);
      
      // Verify refresh token stored in cache
      const cachedToken = await testCache.get(`refresh_token:${result.refreshToken}`);
      expect(cachedToken).toBeDefined();
      expect(JSON.parse(cachedToken).userId).toBe(result.user.id);
    });

    it('should reject login with incorrect password', async () => {
      // Arrange
      const loginData = {
        email: 'testuser@example.com',
        password: 'WrongPassword123!'
      };
      
      // Act & Assert
      await expect(authService.login(loginData))
        .rejects.toThrow('Invalid email or password');
      
      // Verify no session created
      const sessions = await testDb.sessions.findByEmail(loginData.email);
      expect(sessions).toHaveLength(0);
    });

    it('should reject login for non-existent user', async () => {
      // Arrange
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'TestPass123!'
      };
      
      // Act & Assert
      await expect(authService.login(loginData))
        .rejects.toThrow('Invalid email or password');
    });

    it('should reject login for unverified email', async () => {
      // Arrange
      await testDb.users.update('test-user-id', { emailVerified: false });
      const loginData = {
        email: 'testuser@example.com',
        password: 'TestPass123!'
      };
      
      // Act & Assert
      await expect(authService.login(loginData))
        .rejects.toThrow('Please verify your email before logging in');
      
      // Verify verification email resent
      expect(testMailer.sentEmails).toHaveLength(1);
      expect(testMailer.sentEmails[0].subject).toContain('Verify your email');
    });

    it('should reject login for deactivated account', async () => {
      // Arrange
      await testDb.users.update('test-user-id', { isActive: false });
      const loginData = {
        email: 'testuser@example.com',
        password: 'TestPass123!'
      };
      
      // Act & Assert
      await expect(authService.login(loginData))
        .rejects.toThrow('Account has been deactivated');
    });

    it('should track failed login attempts', async () => {
      // Arrange
      const loginData = {
        email: 'testuser@example.com',
        password: 'WrongPassword123!'
      };
      
      // Act - Multiple failed attempts
      for (let i = 0; i < 3; i++) {
        await expect(authService.login(loginData)).rejects.toThrow();
      }
      
      // Assert - Check failed attempts recorded
      const user = await testDb.users.findByEmail(loginData.email);
      expect(user.failedLoginAttempts).toBe(3);
      expect(user.lastFailedLogin).toBeDefined();
    });

    it('should lock account after maximum failed attempts', async () => {
      // Arrange
      const maxAttempts = 5;
      const loginData = {
        email: 'testuser@example.com',
        password: 'WrongPassword123!'
      };
      
      // Act - Exceed max attempts
      for (let i = 0; i < maxAttempts; i++) {
        await expect(authService.login(loginData)).rejects.toThrow();
      }
      
      // Try one more login with correct password
      const correctLogin = {
        email: 'testuser@example.com',
        password: 'TestPass123!'
      };
      
      // Assert
      await expect(authService.login(correctLogin))
        .rejects.toThrow('Account locked due to too many failed login attempts');
      
      // Verify account locked
      const user = await testDb.users.findByEmail(loginData.email);
      expect(user.accountLocked).toBe(true);
      expect(user.accountLockedUntil).toBeDefined();
    });

    it('should implement exponential backoff for repeated failed logins', async () => {
      // Arrange
      const loginData = {
        email: 'testuser@example.com',
        password: 'WrongPassword123!'
      };
      const ipAddress = '192.168.1.50';
      
      // Act & Assert
      const startTime = Date.now();
      
      // First failure - no delay
      await expect(authService.login(loginData, { ipAddress })).rejects.toThrow();
      
      // Second failure - small delay
      await expect(authService.login(loginData, { ipAddress })).rejects.toThrow();
      
      // Third failure - should enforce delay
      await expect(authService.login(loginData, { ipAddress }))
        .rejects.toThrow('Too many failed login attempts. Please wait before trying again.');
      
      const waitTime = await testCache.get(`login_backoff:${ipAddress}`);
      expect(parseInt(waitTime)).toBeGreaterThan(0);
    });

    it('should log successful login with device information', async () => {
      // Arrange
      const loginData = {
        email: 'testuser@example.com',
        password: 'TestPass123!'
      };
      const deviceInfo = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ipAddress: '192.168.1.100',
        deviceId: 'device-123'
      };
      
      // Act
      const result = await authService.login(loginData, deviceInfo);
      
      // Assert
      const loginLog = await testDb.loginHistory.findLatest(result.user.id);
      expect(loginLog).toBeDefined();
      expect(loginLog.ipAddress).toBe(deviceInfo.ipAddress);
      expect(loginLog.userAgent).toBe(deviceInfo.userAgent);
      expect(loginLog.deviceId).toBe(deviceInfo.deviceId);
      expect(loginLog.success).toBe(true);
    });

    it('should detect and alert on suspicious login patterns', async () => {
      // Arrange
      const loginData = {
        email: 'testuser@example.com',
        password: 'TestPass123!'
      };
      
      // First login from USA
      await authService.login(loginData, {
        ipAddress: '1.2.3.4', // USA IP
        country: 'US'
      });
      
      // Immediate login from different country
      await authService.login(loginData, {
        ipAddress: '5.6.7.8', // Russia IP
        country: 'RU'
      });
      
      // Assert - Security alert email sent
      expect(testMailer.sentEmails).toHaveLength(1);
      expect(testMailer.sentEmails[0].subject).toContain('Suspicious login detected');
      expect(testMailer.sentEmails[0].body).toContain('different location');
    });
  });

  describe('Token Refresh Flow', () => {
    let validRefreshToken;
    let userId = 'test-user-id';
    
    beforeEach(async () => {
      // Setup user and valid refresh token
      await testDb.users.create({
        id: userId,
        email: 'testuser@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        isActive: true
      });
      
      validRefreshToken = generateRefreshToken();
      await testCache.set(
        `refresh_token:${validRefreshToken}`,
        JSON.stringify({
          userId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }),
        7 * 24 * 60 * 60 // 7 days TTL
      );
    });

    it('should successfully refresh access token with valid refresh token', async () => {
      // Act
      const result = await authService.refreshToken(validRefreshToken);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(validRefreshToken); // New refresh token issued
      
      // Verify old refresh token invalidated
      const oldToken = await testCache.get(`refresh_token:${validRefreshToken}`);
      expect(oldToken).toBeNull();
      
      // Verify new refresh token stored
      const newToken = await testCache.get(`refresh_token:${result.refreshToken}`);
      expect(newToken).toBeDefined();
    });

    it('should reject expired refresh token', async () => {
      // Arrange
      const expiredToken = generateRefreshToken();
      await testCache.set(
        `refresh_token:${expiredToken}`,
        JSON.stringify({
          userId,
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000) // Expired
        }),
        60 // Short TTL for test
      );
      
      // Act & Assert
      await expect(authService.refreshToken(expiredToken))
        .rejects.toThrow('Refresh token has expired');
    });

    it('should reject non-existent refresh token', async () => {
      // Arrange
      const invalidToken = generateRefreshToken();
      
      // Act & Assert
      await expect(authService.refreshToken(invalidToken))
        .rejects.toThrow('Invalid refresh token');
    });

    it('should reject refresh token for deactivated user', async () => {
      // Arrange
      await testDb.users.update(userId, { isActive: false });
      
      // Act & Assert
      await expect(authService.refreshToken(validRefreshToken))
        .rejects.toThrow('User account is not active');
    });

    it('should implement refresh token rotation', async () => {
      // Act - Use refresh token multiple times
      const result1 = await authService.refreshToken(validRefreshToken);
      
      // Try to reuse the same refresh token
      await expect(authService.refreshToken(validRefreshToken))
        .rejects.toThrow('Invalid refresh token');
      
      // Use the new refresh token
      const result2 = await authService.refreshToken(result1.refreshToken);
      
      // Assert
      expect(result2.success).toBe(true);
      expect(result2.refreshToken).not.toBe(result1.refreshToken);
    });

    it('should detect and prevent refresh token reuse attacks', async () => {
      // Arrange - Simulate token theft scenario
      const result1 = await authService.refreshToken(validRefreshToken);
      
      // Attacker tries to use old token after legitimate user has refreshed
      const attackerAttempt = authService.refreshToken(validRefreshToken);
      
      // Act & Assert
      await expect(attackerAttempt).rejects.toThrow('Invalid refresh token');
      
      // System should invalidate all tokens for this user
      const allUserTokens = await testCache.keys(`refresh_token:*`);
      const userTokens = [];
      for (const key of allUserTokens) {
        const token = await testCache.get(key);
        if (token && JSON.parse(token).userId === userId) {
          userTokens.push(key);
        }
      }
      expect(userTokens).toHaveLength(0);
      
      // Alert email should be sent
      expect(testMailer.sentEmails).toHaveLength(1);
      expect(testMailer.sentEmails[0].subject).toContain('Security Alert');
    });

    it('should maintain token family for device tracking', async () => {
      // Arrange
      const deviceId = 'device-123';
      const tokenWithDevice = generateRefreshToken();
      await testCache.set(
        `refresh_token:${tokenWithDevice}`,
        JSON.stringify({
          userId,
          deviceId,
          family: 'family-123',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      );
      
      // Act
      const result = await authService.refreshToken(tokenWithDevice);
      
      // Assert
      const newTokenData = JSON.parse(
        await testCache.get(`refresh_token:${result.refreshToken}`)
      );
      expect(newTokenData.family).toBe('family-123');
      expect(newTokenData.deviceId).toBe(deviceId);
    });
  });

  describe('Logout Flow', () => {
    let accessToken;
    let refreshToken;
    let sessionId;
    const userId = 'test-user-id';
    
    beforeEach(async () => {
      // Setup authenticated session
      const user = await testDb.users.create({
        id: userId,
        email: 'testuser@example.com',
        passwordHash: 'hash',
        emailVerified: true
      });
      
      accessToken = generateAccessToken({ userId, email: user.email });
      refreshToken = generateRefreshToken();
      sessionId = 'session-123';
      
      await testDb.sessions.create({
        id: sessionId,
        userId,
        accessToken,
        refreshToken,
        isActive: true
      });
      
      await testCache.set(
        `refresh_token:${refreshToken}`,
        JSON.stringify({ userId, sessionId })
      );
    });

    it('should successfully logout and invalidate tokens', async () => {
      // Act
      const result = await authService.logout(accessToken);
      
      // Assert
      expect(result.success).toBe(true);
      
      // Verify session deactivated
      const session = await testDb.sessions.findById(sessionId);
      expect(session.isActive).toBe(false);
      expect(session.loggedOutAt).toBeDefined();
      
      // Verify refresh token removed from cache
      const cachedToken = await testCache.get(`refresh_token:${refreshToken}`);
      expect(cachedToken).toBeNull();
      
      // Verify access token blacklisted
      const blacklisted = await testCache.get(`blacklist:${accessToken}`);
      expect(blacklisted).toBe('true');
    });

    it('should logout all sessions for user', async () => {
      // Arrange - Create multiple sessions
      const sessions = [];
      for (let i = 0; i < 3; i++) {
        const token = generateRefreshToken();
        const session = await testDb.sessions.create({
          id: `session-${i}`,
          userId,
          refreshToken: token,
          isActive: true
        });
        sessions.push(session);
        
        await testCache.set(
          `refresh_token:${token}`,
          JSON.stringify({ userId, sessionId: session.id })
        );
      }
      
      // Act
      const result = await authService.logoutAllSessions(userId);
      
      // Assert
      expect(result.sessionsTerminated).toBe(3);
      
      // Verify all sessions deactivated
      const activeSessions = await testDb.sessions.findActive(userId);
      expect(activeSessions).toHaveLength(0);
      
      // Verify all refresh tokens removed
      for (const session of sessions) {
        const token = await testCache.get(`refresh_token:${session.refreshToken}`);
        expect(token).toBeNull();
      }
    });

    it('should handle logout with invalid/expired token gracefully', async () => {
      // Arrange
      const invalidToken = 'invalid-token';
      
      // Act
      const result = await authService.logout(invalidToken);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('already logged out');
    });

    it('should cleanup expired blacklist entries', async () => {
      // Arrange - Add multiple blacklisted tokens
      const expiredTokens = [];
      for (let i = 0; i < 5; i++) {
        const token = `expired-token-${i}`;
        await testCache.set(`blacklist:${token}`, 'true', 1); // 1 second TTL
        expiredTokens.push(token);
      }
      
      // Wait for tokens to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Add a valid blacklisted token
      await testCache.set(`blacklist:valid-token`, 'true', 3600);
      
      // Act - Trigger cleanup (usually done periodically)
      await authService.cleanupBlacklist();
      
      // Assert
      for (const token of expiredTokens) {
        const exists = await testCache.get(`blacklist:${token}`);
        expect(exists).toBeNull();
      }
      
      const validExists = await testCache.get(`blacklist:valid-token`);
      expect(validExists).toBe('true');
    });
  });

  describe('Password Reset Flow', () => {
    const userId = 'test-user-id';
    const userEmail = 'testuser@example.com';
    
    beforeEach(async () => {
      await testDb.users.create({
        id: userId,
        email: userEmail,
        passwordHash: await hashPassword('OldPassword123!'),
        emailVerified: true,
        isActive: true
      });
    });

    it('should initiate password reset for valid email', async () => {
      // Act
      const result = await authService.requestPasswordReset(userEmail);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Password reset email sent');
      
      // Verify reset token created in database
      const resetToken = await testDb.passwordResets.findByUserId(userId);
      expect(resetToken).toBeDefined();
      expect(resetToken.token).toBeDefined();
      expect(resetToken.expiresAt).toBeDefined();
      expect(resetToken.used).toBe(false);
      
      // Verify email sent
      expect(testMailer.sentEmails).toHaveLength(1);
      expect(testMailer.sentEmails[0].to).toBe(userEmail);
      expect(testMailer.sentEmails[0].subject).toContain('Password Reset');
      expect(testMailer.sentEmails[0].body).toContain(resetToken.token);
    });

    it('should not reveal if email exists (security)', async () => {
      // Arrange
      const nonExistentEmail = 'nonexistent@example.com';
      
      // Act
      const result = await authService.requestPasswordReset(nonExistentEmail);
      
      // Assert - Same response as valid email
      expect(result.success).toBe(true);
      expect(result.message).toContain('Password reset email sent');
      
      // But no email actually sent
      expect(testMailer.sentEmails).toHaveLength(0);
    });

    it('should rate limit password reset requests', async () => {
      // Arrange
      const maxRequests = 3;
      
      // Act - Make multiple requests
      for (let i = 0; i < maxRequests; i++) {
        await authService.requestPasswordReset(userEmail);
      }
      
      // Assert - Next request should be rate limited
      await expect(authService.requestPasswordReset(userEmail))
        .rejects.toThrow('Too many password reset requests');
      
      // Verify only allowed number of emails sent
      expect(testMailer.sentEmails).toHaveLength(maxRequests);
    });

    it('should successfully reset password with valid token', async () => {
      // Arrange
      const { token } = await authService.requestPasswordReset(userEmail);
      const newPassword = 'NewSecurePass123!';
      
      // Act
      const result = await authService.resetPassword(token, newPassword);
      
      // Assert
      expect(result.success).toBe(true);
      
      // Verify password changed
      const user = await testDb.users.findById(userId);
      const isValid = await verifyPassword(newPassword, user.passwordHash);
      expect(isValid).toBe(true);
      
      // Verify token marked as used
      const resetToken = await testDb.passwordResets.findByToken(token);
      expect(resetToken.used).toBe(true);
      expect(resetToken.usedAt).toBeDefined();
      
      // Verify confirmation email sent
      expect(testMailer.sentEmails).toHaveLength(2); // Reset request + confirmation
      expect(testMailer.sentEmails[1].subject).toContain('Password Changed');
    });

    it('should reject expired reset token', async () => {
      // Arrange
      const expiredToken = await testDb.passwordResets.create({
        userId,
        token: generateSecureToken(),
        expiresAt: new Date(Date.now() - 1000), // Expired
        used: false
      });
      
      // Act & Assert
      await expect(authService.resetPassword(expiredToken.token, 'NewPass123!'))
        .rejects.toThrow('Password reset token has expired');
    });

    it('should reject already used reset token', async () => {
      // Arrange
      const usedToken = await testDb.passwordResets.create({
        userId,
        token: generateSecureToken(),
        expiresAt: new Date(Date.now() + 3600000),
        used: true,
        usedAt: new Date()
      });
      
      // Act & Assert
      await expect(authService.resetPassword(usedToken.token, 'NewPass123!'))
        .rejects.toThrow('Password reset token has already been used');
    });

    it('should invalidate all sessions after password reset', async () => {
      // Arrange - Create active sessions
      await testDb.sessions.create({
        id: 'session-1',
        userId,
        isActive: true
      });
      await testDb.sessions.create({
        id: 'session-2',
        userId,
        isActive: true
      });
      
      const { token } = await authService.requestPasswordReset(userEmail);
      
      // Act
      await authService.resetPassword(token, 'NewSecurePass123!');
      
      // Assert - All sessions should be invalidated
      const activeSessions = await testDb.sessions.findActive(userId);
      expect(activeSessions).toHaveLength(0);
    });

    it('should prevent password reuse', async () => {
      // Arrange
      const currentPassword = 'CurrentPass123!';
      await testDb.users.update(userId, {
        passwordHash: await hashPassword(currentPassword)
      });
      
      // Store password history
      await testDb.passwordHistory.create({
        userId,
        passwordHash: await hashPassword(currentPassword),
        createdAt: new Date()
      });
      
      const { token } = await authService.requestPasswordReset(userEmail);
      
      // Act & Assert - Try to reuse current password
      await expect(authService.resetPassword(token, currentPassword))
        .rejects.toThrow('Cannot reuse recent passwords');
    });

    it('should handle concurrent reset requests', async () => {
      // Arrange - Create two reset tokens
      const { token: token1 } = await authService.requestPasswordReset(userEmail);
      const { token: token2 } = await authService.requestPasswordReset(userEmail);
      
      // Act - Use the second token
      const result = await authService.resetPassword(token2, 'NewPass123!');
      
      // Assert
      expect(result.success).toBe(true);
      
      // First token should be invalidated
      await expect(authService.resetPassword(token1, 'AnotherPass123!'))
        .rejects.toThrow('Invalid password reset token');
    });
  });

  describe('Email Verification Flow', () => {
    const userId = 'test-user-id';
    const userEmail = 'unverified@example.com';
    
    beforeEach(async () => {
      await testDb.users.create({
        id: userId,
        email: userEmail,
        passwordHash: 'hash',
        emailVerified: false,
        isActive: true
      });
    });

    it('should send verification email on registration', async () => {
      // Already tested in registration flow
      // This test focuses on the verification process
      
      // Arrange
      const verificationToken = await testDb.emailVerifications.create({
        userId,
        token: generateSecureToken(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });
      
      // Act
      const result = await authService.verifyEmail(verificationToken.token);
      
      // Assert
      expect(result.success).toBe(true);
      
      // Verify user email marked as verified
      const user = await testDb.users.findById(userId);
      expect(user.emailVerified).toBe(true);
      expect(user.emailVerifiedAt).toBeDefined();
      
      // Verify token marked as used
      const token = await testDb.emailVerifications.findByToken(verificationToken.token);
      expect(token.used).toBe(true);
    });

    it('should reject expired verification token', async () => {
      // Arrange
      const expiredToken = await testDb.emailVerifications.create({
        userId,
        token: generateSecureToken(),
        expiresAt: new Date(Date.now() - 1000) // Expired
      });
      
      // Act & Assert
      await expect(authService.verifyEmail(expiredToken.token))
        .rejects.toThrow('Verification token has expired');
      
      // User should remain unverified
      const user = await testDb.users.findById(userId);
      expect(user.emailVerified).toBe(false);
    });

    it('should resend verification email on request', async () => {
      // Act
      const result = await authService.resendVerificationEmail(userEmail);
      
      // Assert
      expect(result.success).toBe(true);
      
      // Verify new token created
      const tokens = await testDb.emailVerifications.findByUserId(userId);
      expect(tokens.length).toBeGreaterThan(0);
      
      // Verify email sent
      expect(testMailer.sentEmails).toHaveLength(1);
      expect(testMailer.sentEmails[0].to).toBe(userEmail);
    });

    it('should rate limit verification email resends', async () => {
      // Arrange
      const maxResends = 3;
      
      // Act
      for (let i = 0; i < maxResends; i++) {
        await authService.resendVerificationEmail(userEmail);
      }
      
      // Assert
      await expect(authService.resendVerificationEmail(userEmail))
        .rejects.toThrow('Too many verification email requests');
    });

    it('should not allow duplicate email verification', async () => {
      // Arrange - Verify email first
      const token = await testDb.emailVerifications.create({
        userId,
        token: generateSecureToken(),
        expiresAt: new Date(Date.now() + 3600000)
      });
      
      await authService.verifyEmail(token.token);
      
      // Act & Assert - Try to verify again
      const newToken = await testDb.emailVerifications.create({
        userId,
        token: generateSecureToken(),
        expiresAt: new Date(Date.now() + 3600000)
      });
      
      await expect(authService.verifyEmail(newToken.token))
        .rejects.toThrow('Email already verified');
    });
  });

  describe('Session Management', () => {
    const userId = 'test-user-id';
    
    beforeEach(async () => {
      await testDb.users.create({
        id: userId,
        email: 'testuser@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        isActive: true
      });
    });

    it('should maintain concurrent session limit per user', async () => {
      // Arrange
      const maxConcurrentSessions = 3;
      const sessions = [];
      
      // Create max allowed sessions
      for (let i = 0; i < maxConcurrentSessions; i++) {
        const session = await authService.createSession(userId, {
          deviceId: `device-${i}`,
          ipAddress: `192.168.1.${i}`
        });
        sessions.push(session);
      }
      
      // Act - Try to create one more session
      const newSession = await authService.createSession(userId, {
        deviceId: 'device-new',
        ipAddress: '192.168.1.100'
      });
      
      // Assert - Oldest session should be terminated
      expect(newSession).toBeDefined();
      
      const oldestSession = await testDb.sessions.findById(sessions[0].id);
      expect(oldestSession.isActive).toBe(false);
      expect(oldestSession.terminationReason).toBe('max_sessions_exceeded');
      
      // Verify only max sessions are active
      const activeSessions = await testDb.sessions.findActive(userId);
      expect(activeSessions).toHaveLength(maxConcurrentSessions);
    });

    it('should extend session on activity', async () => {
      // Arrange
      const session = await authService.createSession(userId, {});
      const originalExpiry = session.expiresAt;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Act
      const extendedSession = await authService.extendSession(session.id);
      
      // Assert
      expect(extendedSession.expiresAt.getTime())
        .toBeGreaterThan(originalExpiry.getTime());
      expect(extendedSession.lastActivity).toBeDefined();
      
      // Verify in database
      const dbSession = await testDb.sessions.findById(session.id);
      expect(dbSession.expiresAt).toEqual(extendedSession.expiresAt);
    });

    it('should terminate inactive sessions', async () => {
      // Arrange - Create sessions with different activity times
      const now = Date.now();
      const inactivityTimeout = 30 * 60 * 1000; // 30 minutes
      
      // Active session
      await testDb.sessions.create({
        id: 'active-session',
        userId,
        lastActivity: new Date(now - 10 * 60 * 1000), // 10 min ago
        isActive: true
      });
      
      // Inactive session
      await testDb.sessions.create({
        id: 'inactive-session',
        userId,
        lastActivity: new Date(now - 40 * 60 * 1000), // 40 min ago
        isActive: true
      });
      
      // Act
      await authService.cleanupInactiveSessions(inactivityTimeout);
      
      // Assert
      const activeSession = await testDb.sessions.findById('active-session');
      expect(activeSession.isActive).toBe(true);
      
      const inactiveSession = await testDb.sessions.findById('inactive-session');
      expect(inactiveSession.isActive).toBe(false);
      expect(inactiveSession.terminationReason).toBe('inactivity');
    });

    it('should track session device fingerprints', async () => {
      // Arrange
      const deviceFingerprint = {
        userAgent: 'Mozilla/5.0...',
        screenResolution: '1920x1080',
        timezone: 'America/New_York',
        language: 'en-US',
        platform: 'MacIntel'
      };
      
      // Act
      const session = await authService.createSession(userId, { deviceFingerprint });
      
      // Assert
      const dbSession = await testDb.sessions.findById(session.id);
      expect(dbSession.deviceFingerprint).toEqual(deviceFingerprint);
      
      // Verify fingerprint changes detection
      const differentFingerprint = { ...deviceFingerprint, screenResolution: '1366x768' };
      const validation = await authService.validateSessionFingerprint(
        session.id, 
        differentFingerprint
      );
      
      expect(validation.matches).toBe(false);
      expect(validation.suspiciousActivity).toBe(true);
    });
  });

  describe('Two-Factor Authentication', () => {
    const userId = 'test-user-id';
    
    beforeEach(async () => {
      await testDb.users.create({
        id: userId,
        email: 'testuser@example.com',
        passwordHash: await hashPassword('TestPass123!'),
        emailVerified: true,
        isActive: true,
        twoFactorEnabled: false
      });
    });

    it('should enable 2FA with TOTP', async () => {
      // Act
      const result = await authService.enableTwoFactor(userId, 'totp');
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.secret).toBeDefined();
      expect(result.qrCode).toBeDefined();
      expect(result.backupCodes).toBeDefined();
      expect(result.backupCodes).toHaveLength(10);
      
      // Verify in database (but not fully enabled yet)
      const user = await testDb.users.findById(userId);
      expect(user.twoFactorEnabled).toBe(false); // Not enabled until verified
      expect(user.twoFactorSecret).toBeDefined();
    });

    it('should verify and activate 2FA', async () => {
      // Arrange - Enable 2FA
      const { secret } = await authService.enableTwoFactor(userId, 'totp');
      const validCode = generateTOTPCode(secret);
      
      // Act
      const result = await authService.verifyTwoFactorSetup(userId, validCode);
      
      // Assert
      expect(result.success).toBe(true);
      
      // Verify 2FA fully enabled
      const user = await testDb.users.findById(userId);
      expect(user.twoFactorEnabled).toBe(true);
      expect(user.twoFactorEnabledAt).toBeDefined();
    });

    it('should require 2FA code during login when enabled', async () => {
      // Arrange - Enable and verify 2FA
      const { secret } = await authService.enableTwoFactor(userId, 'totp');
      const setupCode = generateTOTPCode(secret);
      await authService.verifyTwoFactorSetup(userId, setupCode);
      
      // Act - Login without 2FA code
      const loginResult = await authService.login({
        email: 'testuser@example.com',
        password: 'TestPass123!'
      });
      
      // Assert - Should not get tokens yet
      expect(loginResult.requiresTwoFactor).toBe(true);
      expect(loginResult.tempToken).toBeDefined();
      expect(loginResult.accessToken).toBeUndefined();
      expect(loginResult.refreshToken).toBeUndefined();
      
      // Act - Complete login with 2FA code
      const loginCode = generateTOTPCode(secret);
      const completeResult = await authService.completeTwoFactorLogin(
        loginResult.tempToken,
        loginCode
      );
      
      // Assert
      expect(completeResult.success).toBe(true);
      expect(completeResult.accessToken).toBeDefined();
      expect(completeResult.refreshToken).toBeDefined();
    });

    it('should handle incorrect 2FA codes', async () => {
      // Arrange
      const { secret } = await authService.enableTwoFactor(userId, 'totp');
      await authService.verifyTwoFactorSetup(userId, generateTOTPCode(secret));
      
      const loginResult = await authService.login({
        email: 'testuser@example.com',
        password: 'TestPass123!'
      });
      
      // Act & Assert
      await expect(authService.completeTwoFactorLogin(loginResult.tempToken, '000000'))
        .rejects.toThrow('Invalid two-factor authentication code');
    });

    it('should allow login with backup code', async () => {
      // Arrange
      const { secret, backupCodes } = await authService.enableTwoFactor(userId, 'totp');
      await authService.verifyTwoFactorSetup(userId, generateTOTPCode(secret));
      
      const loginResult = await authService.login({
        email: 'testuser@example.com',
        password: 'TestPass123!'
      });
      
      // Act - Use backup code
      const completeResult = await authService.completeTwoFactorLogin(
        loginResult.tempToken,
        backupCodes[0],
        { isBackupCode: true }
      );
      
      // Assert
      expect(completeResult.success).toBe(true);
      expect(completeResult.accessToken).toBeDefined();
      
      // Verify backup code marked as used
      const usedCodes = await testDb.twoFactorBackupCodes.findUsed(userId);
      expect(usedCodes).toContain(backupCodes[0]);
      
      // Cannot reuse the same backup code
      const newLoginResult = await authService.login({
        email: 'testuser@example.com',
        password: 'TestPass123!'
      });
      
      await expect(authService.completeTwoFactorLogin(
        newLoginResult.tempToken,
        backupCodes[0],
        { isBackupCode: true }
      )).rejects.toThrow('Backup code already used');
    });

    it('should disable 2FA with valid password', async () => {
      // Arrange - Enable 2FA
      const { secret } = await authService.enableTwoFactor(userId, 'totp');
      await authService.verifyTwoFactorSetup(userId, generateTOTPCode(secret));
      
      // Act
      const result = await authService.disableTwoFactor(userId, 'TestPass123!');
      
      // Assert
      expect(result.success).toBe(true);
      
      const user = await testDb.users.findById(userId);
      expect(user.twoFactorEnabled).toBe(false);
      expect(user.twoFactorSecret).toBeNull();
      
      // Backup codes should be deleted
      const backupCodes = await testDb.twoFactorBackupCodes.findByUserId(userId);
      expect(backupCodes).toHaveLength(0);
    });
  });

  describe('OAuth Integration', () => {
    describe('OAuth Login Flow', () => {
      it('should handle Google OAuth login for new user', async () => {
        // Arrange
        const googleProfile = {
          id: 'google-123',
          email: 'user@gmail.com',
          name: 'John Doe',
          picture: 'https://example.com/photo.jpg',
          email_verified: true
        };
        
        // Act
        const result = await authService.oauthLogin('google', googleProfile);
        
        // Assert
        expect(result.success).toBe(true);
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
        expect(result.user.email).toBe(googleProfile.email);
        
        // Verify user created
        const user = await testDb.users.findByEmail(googleProfile.email);
        expect(user).toBeDefined();
        expect(user.oauthProviders).toContain('google');
        expect(user.emailVerified).toBe(true); // Auto-verified from Google
        
        // Verify OAuth connection stored
        const oauthConnection = await testDb.oauthConnections.findByProviderUserId(
          'google',
          googleProfile.id
        );
        expect(oauthConnection).toBeDefined();
        expect(oauthConnection.userId).toBe(user.id);
      });

      it('should link OAuth account to existing user with same email', async () => {
        // Arrange - Existing user
        await testDb.users.create({
          id: userId,
          email: 'user@gmail.com',
          passwordHash: 'hash',
          emailVerified: true
        });
        
        const googleProfile = {
          id: 'google-123',
          email: 'user@gmail.com',
          name: 'John Doe',
          email_verified: true
        };
        
        // Act
        const result = await authService.oauthLogin('google', googleProfile);
        
        // Assert
        expect(result.user.id).toBe(userId);
        
        // Verify OAuth connection linked
        const oauthConnection = await testDb.oauthConnections.findByUserId(userId);
        expect(oauthConnection.provider).toBe('google');
        expect(oauthConnection.providerUserId).toBe(googleProfile.id);
      });

      it('should handle OAuth account already linked to different user', async () => {
        // Arrange - OAuth account linked to user1
        const user1Id = 'user-1';
        await testDb.users.create({
          id: user1Id,
          email: 'user1@example.com'
        });
        
        await testDb.oauthConnections.create({
          userId: user1Id,
          provider: 'google',
          providerUserId: 'google-123'
        });
        
        // User2 tries to link same Google account
        const googleProfile = {
          id: 'google-123',
          email: 'user2@example.com',
          email_verified: true
        };
        
        // Act & Assert
        await expect(authService.oauthLogin('google', googleProfile))
          .rejects.toThrow('This Google account is already linked to another user');
      });

      it('should require email verification for unverified OAuth emails', async () => {
        // Arrange
        const githubProfile = {
          id: 'github-123',
          email: 'user@example.com',
          email_verified: false // GitHub email not verified
        };
        
        // Act
        const result = await authService.oauthLogin('github', githubProfile);
        
        // Assert
        expect(result.success).toBe(true);
        expect(result.requiresEmailVerification).toBe(true);
        expect(result.accessToken).toBeUndefined(); // No tokens until verified
        
        // Verify user created but not verified
        const user = await testDb.users.findByEmail(githubProfile.email);
        expect(user.emailVerified).toBe(false);
        
        // Verify verification email sent
        expect(testMailer.sentEmails).toHaveLength(1);
        expect(testMailer.sentEmails[0].subject).toContain('Verify your email');
      });

      it('should handle OAuth state parameter for CSRF protection', async () => {
        // Arrange
        const state = generateSecureToken();
        await testCache.set(`oauth_state:${state}`, JSON.stringify({
          provider: 'google',
          timestamp: Date.now(),
          redirectUrl: '/dashboard'
        }), 600); // 10 min TTL
        
        // Act - Valid state
        const validResult = await authService.validateOAuthState('google', state);
        
        // Assert
        expect(validResult.valid).toBe(true);
        expect(validResult.redirectUrl).toBe('/dashboard');
        
        // State should be consumed
        const consumedState = await testCache.get(`oauth_state:${state}`);
        expect(consumedState).toBeNull();
        
        // Act - Reuse same state (CSRF attack)
        const reusedResult = await authService.validateOAuthState('google', state);
        expect(reusedResult.valid).toBe(false);
      });
    });
  });

  describe('Security Headers and Middleware', () => {
    it('should validate CSRF tokens in state-changing requests', async () => {
      // Arrange
      const session = await authService.createSession(userId, {});
      const csrfToken = generateCSRFToken(session.id);
      
      // Act - Valid CSRF token
      const validRequest = {
        headers: { 'x-csrf-token': csrfToken },
        session: { id: session.id }
      };
      
      const isValid = await authMiddleware.validateCSRF(validRequest);
      
      // Assert
      expect(isValid).toBe(true);
      
      // Act - Missing CSRF token
      const invalidRequest = {
        headers: {},
        session: { id: session.id }
      };
      
      await expect(authMiddleware.validateCSRF(invalidRequest))
        .rejects.toThrow('CSRF token missing');
    });

    it('should implement secure session cookie settings', async () => {
      // Arrange
      const loginResult = await authService.login({
        email: 'testuser@example.com',
        password: 'TestPass123!'
      });
      
      // Act
      const cookieSettings = authService.getSessionCookieSettings();
      
      // Assert
      expect(cookieSettings).toEqual({
        httpOnly: true,
        secure: true, // HTTPS only
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
        domain: undefined // Let browser handle
      });
    });

    it('should add security headers to responses', async () => {
      // Arrange
      const response = {};
      
      // Act
      authMiddleware.addSecurityHeaders(response);
      
      // Assert
      expect(response.headers).toEqual(expect.objectContaining({
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Content-Security-Policy': expect.stringContaining('default-src'),
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      }));
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle concurrent login requests efficiently', async () => {
      // Arrange
      const concurrentUsers = 100;
      const loginPromises = [];
      
      // Create test users
      for (let i = 0; i < concurrentUsers; i++) {
        await testDb.users.create({
          id: `user-${i}`,
          email: `user${i}@example.com`,
          passwordHash: await hashPassword('TestPass123!'),
          emailVerified: true
        });
      }
      
      // Act - Simulate concurrent logins
      const startTime = Date.now();
      
      for (let i = 0; i < concurrentUsers; i++) {
        loginPromises.push(
          authService.login({
            email: `user${i}@example.com`,
            password: 'TestPass123!'
          })
        );
      }
      
      const results = await Promise.all(loginPromises);
      const endTime = Date.now();
      
      // Assert
      expect(results.every(r => r.success)).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      // Verify all sessions created
      const sessionCount = await testDb.sessions.count();
      expect(sessionCount).toBe(concurrentUsers);
    });

    it('should efficiently validate tokens in bulk', async () => {
      // Arrange
      const tokenCount = 1000;
      const tokens = [];
      const secret = 'test-secret';
      
      for (let i = 0; i < tokenCount; i++) {
        tokens.push(generateAccessToken({ userId: `user-${i}` }, secret));
      }
      
      // Act
      const startTime = Date.now();
      const validationPromises = tokens.map(token => 
        authService.validateToken(token, secret)
      );
      
      const results = await Promise.all(validationPromises);
      const endTime = Date.now();
      
      // Assert
      expect(results.every(r => r.valid)).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle database connection pool exhaustion gracefully', async () => {
      // Arrange - Simulate pool exhaustion
      const originalPoolSize = testDb.getPoolSize();
      testDb.setPoolSize(2); // Very small pool
      
      const concurrentRequests = 10;
      const requests = [];
      
      // Act
      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          authService.login({
            email: 'testuser@example.com',
            password: 'TestPass123!'
          }).catch(err => err)
        );
      }
      
      const results = await Promise.all(requests);
      
      // Assert - Some should succeed, some might queue
      const successes = results.filter(r => r.success);
      const errors = results.filter(r => r instanceof Error);
      
      expect(successes.length).toBeGreaterThan(0);
      expect(errors.length).toBeLessThan(concurrentRequests);
      
      // Restore pool size
      testDb.setPoolSize(originalPoolSize);
    });
  });
});

/**
 * Mock/Stub Requirements for Integration Tests:
 * 
 * 1. Test Database:
 *    - In-memory database or test container
 *    - Transaction support for rollback testing
 *    - Connection pool management
 * 
 * 2. Cache Layer:
 *    - Redis mock or test instance
 *    - TTL support
 *    - Pattern-based key retrieval
 * 
 * 3. Email Service:
 *    - Mock mailer that captures sent emails
 *    - Template rendering verification
 * 
 * 4. External Services:
 *    - OAuth provider mocks
 *    - IP geolocation mock
 *    - Device fingerprinting mock
 * 
 * 5. Time Management:
 *    - Controllable time for expiration testing
 *    - Performance timing utilities
 * 
 * Expected Assertions:
 * - Database state verification after operations
 * - Cache state verification
 * - Email sending verification
 * - Transaction rollback verification
 * - Performance metrics within acceptable ranges
 * - Security policy enforcement
 */