import { authApi } from '../src/services/authApi';

global.fetch = jest.fn();

describe('Mobile Authentication API Service (authApi)', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  test('login sends email and password to /auth/login', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'access_123',
        refreshToken: 'refresh_123',
        user: { id: 'usr_1', email: 'student@campussafe.edu' },
      }),
    });

    const res = await authApi.login({
      email: 'student@campussafe.edu ',
      password: 'Password123!',
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'student@campussafe.edu',
          password: 'Password123!',
        }),
      })
    );
    expect(res.accessToken).toBe('access_123');
  });

  test('login throws formatted error when credentials invalid', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      }),
    });

    await expect(
      authApi.login({ email: 'bad@user.com', password: 'wrong' })
    ).rejects.toThrow('Invalid email or password');
  });

  test('register sends formatted student payload with uppercase roll and campus', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'access_new',
        refreshToken: 'refresh_new',
        user: { id: 'usr_new', email: 'new@student.com' },
        membership: { status: 'PENDING_APPROVAL' },
      }),
    });

    const res = await authApi.register({
      fullName: ' Rohan Sharma ',
      email: 'rohan@student.com ',
      password: 'Password123!',
      rollNumber: 'mca2026-099 ',
      campusCode: 'cseu ',
      phone: '9876543210',
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'rohan@student.com',
          password: 'Password123!',
          fullName: 'Rohan Sharma',
          rollNumber: 'MCA2026-099',
          campusCode: 'CSEU',
          phone: '9876543210',
        }),
      })
    );
    expect(res.membership.status).toBe('PENDING_APPROVAL');
  });

  test('getMe attaches Authorization Bearer token header', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        user: { id: 'usr_1', email: 'student@campussafe.edu' },
      }),
    });

    await authApi.getMe('my_test_jwt_token');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer my_test_jwt_token',
        }),
      })
    );
  });
});
