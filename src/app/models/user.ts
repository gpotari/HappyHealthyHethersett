export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface ManagedUser extends CurrentUser {
  isDisabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface RegisterRequest {
  email: string;
  displayName: string;
  password: string;
}

export interface CreateUserRequest {
  email: string;
  displayName: string;
  password: string;
  roles: string[];
}

export interface UpdateUserRequest {
  displayName: string;
  roles: string[];
  isDisabled: boolean;
}
