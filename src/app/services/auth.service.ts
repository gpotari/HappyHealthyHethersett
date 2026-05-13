import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, map, of, tap } from 'rxjs';
import {
  ChangePasswordRequest,
  CreateUserRequest,
  CurrentUser,
  LoginResponse,
  LoginRequest,
  ManagedUser,
  RegisterRequest,
  UpdateAccountRequest,
  UpdateUserRequest
} from '../models/user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = '/api';
  private readonly tokenStorageKey = 'hhh.auth.token';
  private readonly userStorageKey = 'hhh.auth.user';
  private readonly userSubject = new BehaviorSubject<CurrentUser | null>(this.readStoredUser());
  readonly user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  get currentUser(): CurrentUser | null {
    return this.userSubject.value;
  }

  get token(): string {
    return this.readStoredToken();
  }

  login(request: LoginRequest) {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/auth/login`, request, { withCredentials: true })
      .pipe(
        tap((response) => this.storeSession(response)),
        map((response) => response.user)
      );
  }

  register(request: RegisterRequest) {
    return this.http.post<{ ok: boolean; message: string }>(`${this.apiUrl}/auth/register`, request);
  }

  logout() {
    return this.http
      .post<{ ok: boolean }>(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(
        catchError(() => of({ ok: true })),
        tap(() => this.clearSession())
      );
  }

  loadCurrentUser() {
    return this.http
      .get<CurrentUser>(`${this.apiUrl}/auth/me`, { withCredentials: true })
      .pipe(tap((user) => this.storeUser(user)));
  }

  restoreSession() {
    if (!this.token) {
      this.clearSession();
      return of(null);
    }

    return this.loadCurrentUser().pipe(
      catchError(() => {
        this.clearSession();
        return of(null);
      })
    );
  }

  loadUsers() {
    return this.http.get<ManagedUser[]>(`${this.apiUrl}/users`, { withCredentials: true });
  }

  updateAccount(request: UpdateAccountRequest) {
    return this.http
      .put<CurrentUser>(`${this.apiUrl}/account/profile`, request, { withCredentials: true })
      .pipe(tap((user) => this.storeUser(user)));
  }

  changePassword(request: ChangePasswordRequest) {
    return this.http.post<{ ok: boolean }>(`${this.apiUrl}/account/password`, request, { withCredentials: true });
  }

  createUser(request: CreateUserRequest) {
    return this.http.post<ManagedUser>(`${this.apiUrl}/users`, request, { withCredentials: true });
  }

  updateUser(userId: string, request: UpdateUserRequest) {
    return this.http.put<ManagedUser>(`${this.apiUrl}/users/${userId}`, request, { withCredentials: true });
  }

  resetPassword(userId: string, password: string) {
    return this.http.post<{ ok: boolean }>(
      `${this.apiUrl}/users/${userId}/password`,
      { password },
      { withCredentials: true }
    );
  }

  hasRole(role: string): boolean {
    return this.currentUser?.roles.includes(role) ?? false;
  }

  private storeSession(response: LoginResponse): void {
    this.storeToken(response.token);
    this.storeUser(response.user);
  }

  private storeUser(user: CurrentUser): void {
    this.userSubject.next(user);
    this.safeLocalStorageSet(this.userStorageKey, JSON.stringify(user));
  }

  private storeToken(token: string): void {
    this.safeLocalStorageSet(this.tokenStorageKey, token);
  }

  private clearSession(): void {
    this.userSubject.next(null);
    this.safeLocalStorageRemove(this.tokenStorageKey);
    this.safeLocalStorageRemove(this.userStorageKey);
  }

  private readStoredToken(): string {
    return this.safeLocalStorageGet(this.tokenStorageKey) || '';
  }

  private readStoredUser(): CurrentUser | null {
    const stored = this.safeLocalStorageGet(this.userStorageKey);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as CurrentUser;
    } catch {
      this.safeLocalStorageRemove(this.userStorageKey);
      return null;
    }
  }

  private safeLocalStorageGet(key: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private safeLocalStorageSet(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {
      // If storage is blocked, the in-memory user state still works for the current tab.
    }
  }

  private safeLocalStorageRemove(key: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage failures; auth state has already been cleared in memory.
    }
  }
}
