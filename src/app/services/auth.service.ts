import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap } from 'rxjs';
import {
  CreateUserRequest,
  CurrentUser,
  LoginRequest,
  ManagedUser,
  RegisterRequest,
  UpdateUserRequest
} from '../models/user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = '/api';
  private readonly userSubject = new BehaviorSubject<CurrentUser | null>(null);
  readonly user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  get currentUser(): CurrentUser | null {
    return this.userSubject.value;
  }

  login(request: LoginRequest) {
    return this.http
      .post<CurrentUser>(`${this.apiUrl}/auth/login`, request, { withCredentials: true })
      .pipe(tap((user) => this.userSubject.next(user)));
  }

  register(request: RegisterRequest) {
    return this.http.post<{ ok: boolean; message: string }>(`${this.apiUrl}/auth/register`, request);
  }

  logout() {
    return this.http
      .post<{ ok: boolean }>(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(tap(() => this.userSubject.next(null)));
  }

  loadCurrentUser() {
    return this.http
      .get<CurrentUser>(`${this.apiUrl}/auth/me`, { withCredentials: true })
      .pipe(tap((user) => this.userSubject.next(user)));
  }

  loadUsers() {
    return this.http.get<ManagedUser[]>(`${this.apiUrl}/users`, { withCredentials: true });
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
}
