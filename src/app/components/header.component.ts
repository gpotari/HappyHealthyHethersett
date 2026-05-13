import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AccountAvatarPayload, CurrentUser } from '../models/user';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './header.component.html'
})
export class HeaderComponent implements OnInit, OnDestroy {
  navOpen = false;
  accountOpen = false;
  accountView: 'auth' | 'menu' | 'manage' = 'auth';
  authMode: 'signIn' | 'register' = 'signIn';
  currentUser: CurrentUser | null = null;
  emailInput = '';
  passwordInput = '';
  rememberMe = true;
  loginLoading = false;
  registerNameInput = '';
  registerEmailInput = '';
  registerPasswordInput = '';
  registerConfirmPasswordInput = '';
  registerLoading = false;
  displayNameInput = '';
  currentPasswordInput = '';
  newPasswordInput = '';
  confirmNewPasswordInput = '';
  accountSaving = false;
  passwordSaving = false;
  selectedAvatar?: AccountAvatarPayload;
  clearAvatar = false;
  accountStatus = '';
  accountError = '';
  private userSubscription?: Subscription;

  constructor(private authService: AuthService, private router: Router) {}

  ngOnInit(): void {
    this.userSubscription = this.authService.user$.subscribe((user) => {
      this.currentUser = user;
      if (user) {
        this.accountView = 'menu';
        this.displayNameInput = user.displayName;
      } else {
        this.accountView = 'auth';
      }
    });
    this.authService.restoreSession().subscribe();
  }

  ngOnDestroy(): void {
    this.userSubscription?.unsubscribe();
  }

  toggleNav(): void {
    this.navOpen = !this.navOpen;
    if (this.navOpen) {
      this.accountOpen = false;
    }
  }

  closeNav(): void {
    this.navOpen = false;
  }

  toggleAccountMenu(): void {
    this.accountOpen = !this.accountOpen;
    this.navOpen = false;
    this.accountError = '';
    this.accountStatus = '';
    this.accountView = this.currentUser ? 'menu' : 'auth';
  }

  closeAccountMenu(): void {
    this.accountOpen = false;
    this.accountError = '';
    this.accountStatus = '';
  }

  showAuthMode(mode: 'signIn' | 'register'): void {
    this.authMode = mode;
    this.accountError = '';
    this.accountStatus = '';
  }

  signIn(): void {
    this.accountError = '';
    this.accountStatus = '';
    const email = this.emailInput.trim();
    const password = this.passwordInput.trim();
    if (!email || !password) {
      this.accountError = 'Please enter your email and password.';
      return;
    }

    this.loginLoading = true;
    this.authService.login({ email, password, rememberMe: this.rememberMe }).subscribe({
      next: () => {
        this.loginLoading = false;
        this.emailInput = '';
        this.passwordInput = '';
        this.accountView = 'menu';
      },
      error: () => {
        this.loginLoading = false;
        this.accountError = 'Incorrect email or password.';
      }
    });
  }

  register(): void {
    this.accountError = '';
    this.accountStatus = '';
    const email = this.registerEmailInput.trim();
    const displayName = this.registerNameInput.trim();
    const password = this.registerPasswordInput.trim();
    const confirmPassword = this.registerConfirmPasswordInput.trim();

    if (!email || !displayName || !password) {
      this.accountError = 'Please complete your name, email and password.';
      return;
    }

    if (password.length < 10) {
      this.accountError = 'Passwords must be at least 10 characters.';
      return;
    }

    if (password !== confirmPassword) {
      this.accountError = 'Passwords do not match.';
      return;
    }

    this.registerLoading = true;
    this.authService.register({ email, displayName, password }).subscribe({
      next: () => {
        this.registerLoading = false;
        this.registerNameInput = '';
        this.registerEmailInput = '';
        this.registerPasswordInput = '';
        this.registerConfirmPasswordInput = '';
        this.authMode = 'signIn';
        this.accountStatus = 'Registration sent. An admin needs to enable the account before you can sign in.';
      },
      error: () => {
        this.registerLoading = false;
        this.accountError = 'Unable to register. The email may already be in use.';
      }
    });
  }

  openManageAccount(): void {
    if (!this.currentUser) {
      return;
    }

    this.accountView = 'manage';
    this.displayNameInput = this.currentUser.displayName;
    this.currentPasswordInput = '';
    this.newPasswordInput = '';
    this.confirmNewPasswordInput = '';
    this.selectedAvatar = undefined;
    this.clearAvatar = false;
    this.accountError = '';
    this.accountStatus = '';
  }

  saveProfile(): void {
    if (!this.currentUser) {
      return;
    }

    const displayName = this.displayNameInput.trim();
    if (!displayName) {
      this.accountError = 'Please enter your name.';
      return;
    }

    this.accountSaving = true;
    this.accountError = '';
    this.accountStatus = '';
    this.authService
      .updateAccount({
        displayName,
        avatar: this.selectedAvatar || null,
        clearAvatar: this.clearAvatar
      })
      .subscribe({
        next: () => {
          this.accountSaving = false;
          this.selectedAvatar = undefined;
          this.clearAvatar = false;
          this.accountStatus = 'Account updated.';
        },
        error: () => {
          this.accountSaving = false;
          this.accountError = 'Unable to update your account.';
        }
      });
  }

  changePassword(): void {
    const currentPassword = this.currentPasswordInput.trim();
    const newPassword = this.newPasswordInput.trim();
    const confirmPassword = this.confirmNewPasswordInput.trim();

    if (!currentPassword || !newPassword) {
      this.accountError = 'Please enter your current and new password.';
      return;
    }

    if (newPassword.length < 10) {
      this.accountError = 'Passwords must be at least 10 characters.';
      return;
    }

    if (newPassword !== confirmPassword) {
      this.accountError = 'New passwords do not match.';
      return;
    }

    this.passwordSaving = true;
    this.accountError = '';
    this.accountStatus = '';
    this.authService.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        this.passwordSaving = false;
        this.currentPasswordInput = '';
        this.newPasswordInput = '';
        this.confirmNewPasswordInput = '';
        this.accountStatus = 'Password changed.';
      },
      error: () => {
        this.passwordSaving = false;
        this.accountError = 'Unable to change password. Check your current password.';
      }
    });
  }

  async onAvatarSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.accountError = 'Please choose an image file.';
      input.value = '';
      return;
    }

    if (file.size > 1_000_000) {
      this.accountError = 'Please choose an avatar under 1MB.';
      input.value = '';
      return;
    }

    this.selectedAvatar = {
      fileName: file.name,
      contentType: file.type || 'image/jpeg',
      dataUrl: await this.readFileAsDataUrl(file)
    };
    this.clearAvatar = false;
    this.accountError = '';
    input.value = '';
  }

  removeAvatar(): void {
    this.selectedAvatar = undefined;
    this.clearAvatar = true;
  }

  goToAdmin(): void {
    this.closeAccountMenu();
    this.router.navigate(['/admin']);
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.closeAccountMenu();
        this.router.navigate(['/']);
      }
    });
  }

  get hasAdminRole(): boolean {
    return this.currentUser?.roles.includes('Admin') ?? false;
  }

  get avatarPreview(): string {
    if (this.clearAvatar) {
      return '';
    }

    return this.selectedAvatar?.dataUrl || this.currentUser?.avatarDataUrl || '';
  }

  get accountInitials(): string {
    const source = this.currentUser?.displayName || this.currentUser?.email || 'Account';
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'A';
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
