import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, Subscription } from 'rxjs';
import { EventItem } from '../models/event-item';
import { FeedbackMessage } from '../models/feedback-message';
import { LitterPickArea, LitterPickEvent } from '../models/litter-pick-event';
import { LitterReport } from '../models/litter-report';
import { PhotoAttachment } from '../models/photo-attachment';
import { CurrentUser, ManagedUser } from '../models/user';
import {
  BoundaryCoordinate,
  HETHERSETT_BOUNDARY,
  HETHERSETT_BOUNDARY_SOURCE,
  MapPoint
} from '../data/hethersett-boundary';
import { LITTER_PICK_TEAM_STICKERS, TeamSticker } from '../data/team-stickers';
import { EventsService } from '../services/events.service';
import { AuthService } from '../services/auth.service';
import { FeedbackService } from '../services/feedback.service';
import { LitterPickEventsService } from '../services/litter-pick-events.service';
import { LitterReportsService } from '../services/litter-reports.service';

type AdminSection = 'events' | 'feedback' | 'reports' | 'litterPicks' | 'users';
type AuthMode = 'signIn' | 'register';
type EventRequiredField = 'title' | 'date' | 'start' | 'end' | 'description';
type LitterPickRequiredField = 'date' | 'start' | 'end' | 'meetingPoint';

type MapTile = {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
};

type LitterPickMapMode = 'draw' | 'pan' | 'edit' | 'meeting';
type MeetingPointTarget = 'new' | 'draft';

type AreaEditDragState = {
  pointerId: number;
  areaId: string;
  kind: 'vertex' | 'move';
  startPoint: MapPoint;
  originalPoints: MapPoint[];
  pointIndex?: number;
};

type LitterPickLeaderboardRow = {
  rank: number;
  medal: string;
  area: LitterPickArea;
  bags: number;
  volunteers: number;
  coverage: number;
  originalIndex: number;
};

type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfImageResource = {
  name: string;
  width: number;
  height: number;
  data: Uint8Array;
};

type PdfPage = {
  commands: string[];
  images: PdfImageResource[];
};

@Component({
  selector: 'app-admin-events',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-events.component.html',
  styleUrl: './admin-events.component.css'
})
export class AdminEventsComponent implements OnInit, AfterViewChecked, OnDestroy {
  private readonly maxPhotosPerItem = 12;
  private readonly uploadPhotoMaxEdge = 1400;
  private readonly uploadPhotoQuality = 0.78;

  readonly defaultMeetingPoint = {
    label: 'Hethersett Methodist Church',
    lat: 52.60099,
    lng: 1.17553,
    icon: '🌳'
  };
  authMode: AuthMode = 'signIn';
  emailInput = '';
  passwordInput = '';
  rememberMe = false;
  loginLoading = false;
  registerNameInput = '';
  registerEmailInput = '';
  registerPasswordInput = '';
  registerConfirmPasswordInput = '';
  registerLoading = false;
  registerMessage = '';
  authChecking = true;
  isUnlocked = false;
  currentUser: CurrentUser | null = null;
  activeAdminSection: AdminSection = 'events';
  errorMessage = '';
  statusMessage = '';
  events: EventItem[] = [];
  feedbackMessages: FeedbackMessage[] = [];
  reports: LitterReport[] = [];
  litterPickEvents: LitterPickEvent[] = [];
  users: ManagedUser[] = [];
  usersLoading = false;
  usersSaving = false;
  usersError = '';
  resetPasswords: Record<string, string> = {};
  pendingUserRoles: Record<string, 'Admin' | 'Editor'> = {};
  pendingUserDisabled: Record<string, boolean> = {};
  newUser = this.emptyUserForm();
  reportsLoading = false;
  reportsError = '';
  feedbackLoading = false;
  feedbackError = '';
  litterPicksLoading = false;
  litterPicksError = '';
  newEvent: EventItem = this.emptyEvent();
  newLitterPickEvent: LitterPickEvent = this.emptyLitterPickEvent();
  eventCreateAttempted = false;
  eventEditAttempted = false;
  litterPickCreateAttempted = false;
  litterPickEditAttempted = false;
  showCreateForm = false;
  showLitterPickCreateForm = false;
  showUserCreateForm = false;
  expandedIndex: number | null = null;
  expandedLitterPickIndex: number | null = null;
  isEditing = false;
  isEditingLitterPick = false;
  litterPickPhotoChangePending = false;
  draftEvent: EventItem | null = null;
  draftLitterPickEvent: LitterPickEvent | null = null;
  activeAreaId: string | null = null;
  draftAreaPoints: MapPoint[] = [];
  readonly boundarySource = HETHERSETT_BOUNDARY_SOURCE;
  readonly mapBoundaryPoints = this.createBoundaryPoints();
  readonly mapBoundaryPointsAttribute = this.mapBoundaryPoints
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  readonly coverageSamplePoints = this.createCoverageSamplePoints();
  readonly tileSize = 256;
  readonly minLitterPickZoom = 13;
  readonly maxLitterPickZoom = 18;
  readonly teamStickers = LITTER_PICK_TEAM_STICKERS;
  litterPickZoom = 13.7;
  litterPickCenterLat = 52.5966;
  litterPickCenterLng = 1.181;
  litterPickViewportWidth = 760;
  litterPickViewportHeight = 420;
  litterPickMapMode: LitterPickMapMode = 'pan';
  litterPickWorkspaceFullscreen = false;
  editingAreaId: string | null = null;
  meetingPointTarget: MeetingPointTarget | null = null;
  private dragStart: MapPoint | null = null;
  private areaEditDrag?: AreaEditDragState;
  panState?: {
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: MapPoint;
  };
  private resizeObserver?: ResizeObserver;
  private observedLitterPickMap?: HTMLElement;
  private authSubscription?: Subscription;
  private adminWorkspaceLoaded = false;

  @ViewChild('litterPickMap') litterPickMap?: ElementRef<HTMLElement>;

  constructor(
    private host: ElementRef<HTMLElement>,
    private authService: AuthService,
    private eventsService: EventsService,
    private feedbackService: FeedbackService,
    private litterPickEventsService: LitterPickEventsService,
    private litterReportsService: LitterReportsService
  ) {}

  ngOnInit(): void {
    this.authSubscription = this.authService.user$.subscribe((user) => {
      if (this.authChecking) {
        this.currentUser = user;
        this.isUnlocked = user?.roles.includes('Admin') ?? false;
        return;
      }

      this.handleAuthenticatedUser(user);
    });
    this.authService.restoreSession().subscribe({
      next: () => {
        this.authChecking = false;
        this.handleAuthenticatedUser(this.authService.currentUser);
      },
      error: () => {
        this.authChecking = false;
        this.handleAuthenticatedUser(this.authService.currentUser);
      }
    });
  }

  ngAfterViewChecked(): void {
    if (!this.litterPickMap?.nativeElement || this.observedLitterPickMap === this.litterPickMap.nativeElement) {
      return;
    }

    this.resizeObserver?.disconnect();
    this.observedLitterPickMap = this.litterPickMap.nativeElement;
    this.updateLitterPickViewportSize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.updateLitterPickViewportSize());
      this.resizeObserver.observe(this.litterPickMap.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.authSubscription?.unsubscribe();
    this.resizeObserver?.disconnect();
  }

  unlock(): void {
    this.errorMessage = '';
    this.registerMessage = '';
    const email = this.emailInput.trim();
    const password = this.passwordInput.trim();
    if (!email || !password) {
      this.errorMessage = 'Please enter your email and password.';
      return;
    }
    this.loginLoading = true;
    this.authService.login({ email, password, rememberMe: this.rememberMe }).subscribe({
      next: (user) => {
        this.loginLoading = false;
        this.emailInput = '';
        this.passwordInput = '';
        this.handleAuthenticatedUser(user);
      },
      error: () => {
        this.loginLoading = false;
        this.errorMessage = 'Incorrect email or password. Please try again.';
      }
    });
  }

  showAuthMode(mode: AuthMode): void {
    this.authMode = mode;
    this.errorMessage = '';
    this.registerMessage = '';
  }

  registerUser(): void {
    this.errorMessage = '';
    this.registerMessage = '';
    const email = this.registerEmailInput.trim();
    const displayName = this.registerNameInput.trim();
    const password = this.registerPasswordInput.trim();
    const confirmPassword = this.registerConfirmPasswordInput.trim();

    if (!email || !displayName || !password) {
      this.errorMessage = 'Please complete your name, email and password.';
      return;
    }

    if (password.length < 10) {
      this.errorMessage = 'Passwords must be at least 10 characters.';
      return;
    }

    if (password !== confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
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
        this.registerMessage = 'Registration sent. An admin needs to enable the account before you can sign in.';
      },
      error: () => {
        this.registerLoading = false;
        this.errorMessage = 'Unable to register. The email may already be in use.';
      }
    });
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.handleAuthenticatedUser(null);
        this.statusMessage = '';
        this.errorMessage = '';
      },
      error: () => {
        this.errorMessage = 'Unable to sign out. Please refresh and try again.';
      }
    });
  }

  addEvent(): void {
    this.statusMessage = '';
    this.eventCreateAttempted = true;
    if (!this.isEventValid(this.newEvent)) {
      this.errorMessage = 'Please complete the highlighted fields before creating the event.';
      return;
    }
    this.errorMessage = '';
    const updated = [...this.events, this.cloneEvent(this.newEvent)];
    this.saveEvents(updated, 'Event added and saved.', () => {
      this.newEvent = this.emptyEvent();
      this.eventCreateAttempted = false;
      this.showCreateForm = false;
    });
  }

  deleteEvent(index: number): void {
    this.statusMessage = '';
    const updated = this.events.filter((_, i) => i !== index);
    this.saveEvents(updated, 'Event deleted and saved.', () => {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
    });
  }

  addLitterPickEvent(): void {
    this.statusMessage = '';
    this.litterPickCreateAttempted = true;
    if (!this.isLitterPickEventValid(this.newLitterPickEvent)) {
      this.errorMessage = this.litterPickValidationMessage('creating');
      return;
    }

    this.errorMessage = '';
    const now = new Date().toISOString();
    const event: LitterPickEvent = {
      ...this.cloneLitterPickEvent(this.newLitterPickEvent),
      id: this.createId('litter-pick'),
      status: 'open',
      areas: [],
      createdAt: now,
      updatedAt: now
    };
    const updated = [event, ...this.litterPickEvents];
    this.saveLitterPickEvents(updated, 'Litter pick event created. Use + Team to draw coverage.', (events) => {
      this.newLitterPickEvent = this.emptyLitterPickEvent();
      this.litterPickCreateAttempted = false;
      this.showLitterPickCreateForm = false;
      this.openLitterPickDraft(events.findIndex((item) => item.id === event.id), true);
    });
  }

  deleteLitterPickEvent(index: number): void {
    this.statusMessage = '';
    const updated = this.litterPickEvents.filter((_, i) => i !== index);
    this.saveLitterPickEvents(updated, 'Litter pick event deleted and saved.', () => {
      this.expandedLitterPickIndex = null;
      this.isEditingLitterPick = false;
      this.draftLitterPickEvent = null;
      this.activeAreaId = null;
    });
  }

  saveChanges(): void {
    this.errorMessage = '';
    this.saveEvents(this.events, 'Events saved. The public page updates immediately.', () => {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
    });
  }

  downloadJson(): void {
    const payload = JSON.stringify(this.events, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'events.json';
    anchor.click();
    URL.revokeObjectURL(url);
    this.statusMessage = 'Downloaded events.json.';
  }

  async uploadJson(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EventItem[];
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid file format');
      }
      const normalized = this.sortLatestFirst(parsed.map((item) => this.cloneEvent(item)));
      this.saveEvents(normalized, 'Events loaded from file and saved.');
    } catch {
      this.errorMessage = 'Unable to read that file. Please upload a valid events JSON.';
    } finally {
      input.value = '';
    }
  }

  async attachEventPhotos(event: Event, target: EventItem): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) {
      return;
    }
    try {
      const currentPhotos = target.photos || [];
      const availablePhotoSlots = this.maxPhotosPerItem - currentPhotos.length;
      if (availablePhotoSlots <= 0) {
        this.errorMessage = `You can attach up to ${this.maxPhotosPerItem} photos.`;
        return;
      }

      const photos = await Promise.all(
        files
          .filter((file) => file.type.startsWith('image/'))
          .slice(0, availablePhotoSlots)
          .map((file) => this.createPhotoAttachment(file))
      );
      if (!photos.length) {
        this.errorMessage = 'Please choose image files to attach.';
        return;
      }
      target.photos = [...currentPhotos, ...photos];
      target.imageUrl = '';
      target.imageAlt = '';
      this.errorMessage = '';
      this.statusMessage = `${photos.length} photo${photos.length === 1 ? '' : 's'} attached. Save changes to keep them.`;
    } catch {
      this.errorMessage = 'Unable to read one of those photos.';
    } finally {
      input.value = '';
    }
  }

  removeEventPhoto(target: EventItem, index: number): void {
    target.photos = (target.photos || []).filter((_, photoIndex) => photoIndex !== index);
  }

  async attachLitterPickPhotos(event: Event, target: LitterPickEvent): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) {
      return;
    }

    try {
      const currentPhotos = target.photos || [];
      const availablePhotoSlots = this.maxPhotosPerItem - currentPhotos.length;
      if (availablePhotoSlots <= 0) {
        this.errorMessage = `You can attach up to ${this.maxPhotosPerItem} photos.`;
        return;
      }

      const photos = await Promise.all(
        files
          .filter((file) => file.type.startsWith('image/'))
          .slice(0, availablePhotoSlots)
          .map((file) => this.createPhotoAttachment(file))
      );
      if (!photos.length) {
        this.errorMessage = 'Please choose image files to attach.';
        return;
      }
      target.photos = [...currentPhotos, ...photos];
      this.markLitterPickPhotoChangesPending(target);
      this.errorMessage = '';
      this.statusMessage = `${photos.length} photo${photos.length === 1 ? '' : 's'} attached. Save changes to keep them.`;
    } catch {
      this.errorMessage = 'Unable to read one of those photos.';
    } finally {
      input.value = '';
    }
  }

  removeLitterPickPhoto(target: LitterPickEvent, index: number): void {
    target.photos = (target.photos || []).filter((_, photoIndex) => photoIndex !== index);
    this.markLitterPickPhotoChangesPending(target);
    this.errorMessage = '';
    this.statusMessage = 'Photo removed. Save changes to keep it.';
  }

  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    if (this.showCreateForm) {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
      this.eventCreateAttempted = false;
      this.showLitterPickCreateForm = false;
      this.litterPickCreateAttempted = false;
      this.closeLitterPickDetails();
    }
    this.statusMessage = '';
    this.errorMessage = '';
  }

  toggleLitterPickCreateForm(): void {
    this.showLitterPickCreateForm = !this.showLitterPickCreateForm;
    if (this.showLitterPickCreateForm) {
      this.newLitterPickEvent = this.emptyLitterPickEvent();
      this.litterPickCreateAttempted = false;
      this.showCreateForm = false;
      this.closeDetails();
      this.closeLitterPickDetails();
    } else if (this.meetingPointTarget === 'new') {
      this.setLitterPickMapMode('pan');
    }
    this.statusMessage = '';
    this.errorMessage = '';
  }

  toggleDetails(index: number): void {
    if (this.expandedIndex === index) {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
      this.eventEditAttempted = false;
      return;
    }
    this.expandedIndex = index;
    this.isEditing = false;
    this.draftEvent = this.cloneEvent(this.events[index]);
    this.eventEditAttempted = false;
    this.showCreateForm = false;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  toggleLitterPickDetails(index: number): void {
    if (this.expandedLitterPickIndex === index) {
      this.closeLitterPickDetails();
      return;
    }

    this.openLitterPickDraft(index, this.litterPickEvents[index]?.status === 'open');
    this.showCreateForm = false;
    this.showLitterPickCreateForm = false;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  closeDetails(): void {
    this.expandedIndex = null;
    this.isEditing = false;
    this.draftEvent = null;
    this.eventEditAttempted = false;
  }

  closeLitterPickDetails(): void {
    this.expandedLitterPickIndex = null;
    this.isEditingLitterPick = false;
    this.litterPickPhotoChangePending = false;
    this.litterPickEditAttempted = false;
    this.draftLitterPickEvent = null;
    this.activeAreaId = null;
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.editingAreaId = null;
    this.meetingPointTarget = null;
    this.areaEditDrag = undefined;
    this.litterPickMapMode = 'pan';
    this.litterPickWorkspaceFullscreen = false;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.observedLitterPickMap = undefined;
  }

  startEdit(): void {
    if (!this.draftEvent) {
      return;
    }
    this.isEditing = true;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  startLitterPickEdit(): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    this.isEditingLitterPick = true;
    this.litterPickEditAttempted = false;
    this.litterPickMapMode = 'pan';
    this.editingAreaId = null;
    this.meetingPointTarget = null;
    this.areaEditDrag = undefined;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  saveEdit(): void {
    if (this.expandedIndex === null || !this.draftEvent) {
      return;
    }
    this.eventEditAttempted = true;
    if (!this.isEventValid(this.draftEvent)) {
      this.errorMessage = 'Please complete the highlighted fields before saving.';
      return;
    }
    const updated = [...this.events];
    updated[this.expandedIndex] = this.cloneEvent(this.draftEvent);
    this.saveEvents(updated, 'Event updated and saved.', () => {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
      this.eventEditAttempted = false;
    });
  }

  saveLitterPickEdit(): void {
    if (this.expandedLitterPickIndex === null || !this.draftLitterPickEvent) {
      return;
    }

    this.litterPickEditAttempted = true;
    if (!this.isLitterPickEventValid(this.draftLitterPickEvent)) {
      this.errorMessage = this.litterPickValidationMessage('saving');
      return;
    }

    const updated = [...this.litterPickEvents];
    updated[this.expandedLitterPickIndex] = {
      ...this.cloneLitterPickEvent(this.draftLitterPickEvent),
      updatedAt: new Date().toISOString()
    };
    this.saveLitterPickEvents(updated, 'Litter pick event updated and saved.', (events) => {
      const index = events.findIndex((event) => event.id === this.draftLitterPickEvent?.id);
      this.openLitterPickDraft(index, false);
      this.isEditingLitterPick = false;
      this.litterPickPhotoChangePending = false;
      this.litterPickEditAttempted = false;
      this.editingAreaId = null;
      this.areaEditDrag = undefined;
    });
  }

  closeLitterPickEvent(): void {
    if (this.expandedLitterPickIndex === null || !this.draftLitterPickEvent) {
      return;
    }

    this.draftLitterPickEvent.status = 'closed';
    this.saveLitterPickEdit();
  }

  async downloadLitterPickReport(): Promise<void> {
    if (!this.draftLitterPickEvent) {
      return;
    }

    const event = this.cloneLitterPickEvent(this.draftLitterPickEvent);
    const blob = await this.createLitterPickReportPdf(event);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hethersett-litter-pick-results-${event.date || this.todayInputValue()}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.statusMessage = 'PDF litter pick report created.';
  }

  isExpanded(index: number): boolean {
    return this.expandedIndex === index;
  }

  isLitterPickExpanded(index: number): boolean {
    return this.expandedLitterPickIndex === index;
  }

  showSection(section: AdminSection): void {
    this.activeAdminSection = section;
    this.statusMessage = '';
    this.errorMessage = '';

    if (section === 'reports') {
      this.closeDetails();
      this.closeLitterPickDetails();
      this.showCreateForm = false;
      this.showLitterPickCreateForm = false;
      this.showUserCreateForm = false;
      this.loadReports();
    }

    if (section === 'feedback') {
      this.closeDetails();
      this.closeLitterPickDetails();
      this.showCreateForm = false;
      this.showLitterPickCreateForm = false;
      this.showUserCreateForm = false;
      this.loadFeedbackMessages();
    }

    if (section === 'events') {
      this.closeLitterPickDetails();
      this.showLitterPickCreateForm = false;
    }

    if (section === 'litterPicks') {
      this.closeDetails();
      this.showCreateForm = false;
      this.showUserCreateForm = false;
      this.loadLitterPickEvents();
    }

    if (section === 'users') {
      this.closeDetails();
      this.closeLitterPickDetails();
      this.showCreateForm = false;
      this.showLitterPickCreateForm = false;
      this.showUserCreateForm = false;
      this.loadUsers();
    }
  }

  get canManageUsers(): boolean {
    return this.currentUser?.roles.includes('Admin') ?? false;
  }

  get isSignedInWithoutAdminAccess(): boolean {
    return Boolean(this.currentUser && !this.isUnlocked);
  }

  private handleAuthenticatedUser(user: CurrentUser | null): void {
    const previousUserId = this.currentUser?.id || null;
    const wasUnlocked = this.isUnlocked;
    this.currentUser = user;
    this.isUnlocked = user?.roles.includes('Admin') ?? false;

    if (this.isUnlocked) {
      if (!this.adminWorkspaceLoaded || !wasUnlocked || previousUserId !== user?.id) {
        this.adminWorkspaceLoaded = true;
        this.loadAdminWorkspace();
      }
      return;
    }

    if (wasUnlocked || previousUserId !== (user?.id || null)) {
      this.clearAdminWorkspace();
    }
  }

  private loadAdminWorkspace(): void {
    this.eventsService.loadEvents().subscribe(() => {
      this.loadEvents();
    });
    this.loadReports();
    this.loadFeedbackMessages();
    this.loadLitterPickEvents();
    this.loadUsers();
  }

  private clearAdminWorkspace(): void {
    this.adminWorkspaceLoaded = false;
    this.events = [];
    this.feedbackMessages = [];
    this.reports = [];
    this.litterPickEvents = [];
    this.users = [];
    this.resetPasswords = {};
    this.pendingUserRoles = {};
    this.pendingUserDisabled = {};
    this.showCreateForm = false;
    this.showLitterPickCreateForm = false;
    this.showUserCreateForm = false;
    this.closeDetails();
    this.closeLitterPickDetails();
  }

  toggleUserCreateForm(): void {
    this.showUserCreateForm = !this.showUserCreateForm;
    if (this.showUserCreateForm) {
      this.newUser = this.emptyUserForm();
      this.closeDetails();
      this.closeLitterPickDetails();
      this.showCreateForm = false;
      this.showLitterPickCreateForm = false;
    }
    this.usersError = '';
    this.statusMessage = '';
  }

  addUser(): void {
    this.usersError = '';
    this.statusMessage = '';
    const email = this.newUser.email.trim();
    const password = this.newUser.password.trim();
    if (!email || !password) {
      this.usersError = 'Email and a temporary password are required.';
      return;
    }

    this.authService
      .createUser({
        email,
        displayName: this.newUser.displayName.trim(),
        password,
        roles: [this.newUser.role]
      })
      .subscribe({
        next: (user) => {
          this.users = [...this.users, user].sort((a, b) => a.email.localeCompare(b.email));
          this.pendingUserRoles[user.id] = this.userRole(user) as 'Admin' | 'Editor';
          this.pendingUserDisabled[user.id] = user.isDisabled;
          this.newUser = this.emptyUserForm();
          this.showUserCreateForm = false;
          this.statusMessage = 'User created.';
        },
        error: () => {
          this.usersError = 'Unable to create user. Check the email and password length.';
        }
      });
  }

  setUserRole(user: ManagedUser, role: string): void {
    if (role !== 'Admin' && role !== 'Editor') {
      return;
    }

    this.pendingUserRoles[user.id] = role;
  }

  toggleUserDisabled(user: ManagedUser): void {
    if (this.currentUser?.id === user.id) {
      return;
    }

    this.pendingUserDisabled[user.id] = !this.selectedUserDisabled(user);
  }

  saveUserChanges(): void {
    this.usersError = '';
    this.statusMessage = '';

    if (this.users.some((user) => {
      const password = (this.resetPasswords[user.id] || '').trim();
      return password.length > 0 && password.length < 10;
    })) {
      this.usersError = 'Passwords must be at least 10 characters.';
      return;
    }

    const operations = this.users.flatMap((user) => {
      const saves = [];
      const selectedRole = this.selectedUserRole(user);
      const selectedDisabled = this.selectedUserDisabled(user);
      const password = (this.resetPasswords[user.id] || '').trim();

      if (selectedRole !== this.userRole(user) || selectedDisabled !== user.isDisabled) {
        saves.push(
          this.authService.updateUser(user.id, {
            displayName: user.displayName,
            roles: [selectedRole],
            isDisabled: selectedDisabled
          })
        );
      }

      if (password) {
        saves.push(this.authService.resetPassword(user.id, password));
      }

      return saves;
    });

    if (!operations.length) {
      this.statusMessage = 'No user changes to save.';
      return;
    }

    this.usersSaving = true;
    forkJoin(operations).subscribe({
      next: () => {
        this.resetPasswords = {};
        this.usersError = '';
        this.usersSaving = false;
        this.statusMessage = 'User changes saved.';
        this.loadUsers();
      },
      error: () => {
        this.usersSaving = false;
        this.usersError = 'Unable to save user changes.';
      }
    });
  }

  userRole(user: ManagedUser): string {
    return user.roles.includes('Admin') ? 'Admin' : 'Editor';
  }

  selectedUserRole(user: ManagedUser): 'Admin' | 'Editor' {
    return this.pendingUserRoles[user.id] ?? (this.userRole(user) as 'Admin' | 'Editor');
  }

  hasPendingUserRole(user: ManagedUser): boolean {
    return this.selectedUserRole(user) !== this.userRole(user);
  }

  selectedUserDisabled(user: ManagedUser): boolean {
    return this.pendingUserDisabled[user.id] ?? user.isDisabled;
  }

  hasPendingUserDisabled(user: ManagedUser): boolean {
    return this.selectedUserDisabled(user) !== user.isDisabled;
  }

  hasUnsavedUserChanges(): boolean {
    return this.users.some(
      (user) =>
        this.hasPendingUserRole(user) ||
        this.hasPendingUserDisabled(user) ||
        Boolean((this.resetPasswords[user.id] || '').trim())
    );
  }

  formatUserDate(value?: string): string {
    if (!value) {
      return 'Never';
    }

    return this.formatDateTime(value);
  }

  private formatDateTime(value: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  refreshReports(): void {
    this.loadReports();
  }

  refreshFeedback(): void {
    this.loadFeedbackMessages();
  }

  deleteFeedback(message: FeedbackMessage): void {
    this.statusMessage = '';
    this.feedbackError = '';
    this.feedbackService.deleteFeedback(message.id).subscribe({
      next: () => {
        this.feedbackMessages = this.feedbackMessages.filter((item) => item.id !== message.id);
        this.statusMessage = 'Feedback message deleted.';
      },
      error: () => {
        this.feedbackError = 'Unable to delete that feedback message.';
      }
    });
  }

  formatFeedbackDate(message: FeedbackMessage): string {
    return this.formatDateTime(message.createdAt);
  }

  formatReportDate(report: LitterReport): string {
    if (!report.createdAt) {
      return 'Unknown date';
    }

    return this.formatDateTime(report.createdAt);
  }

  reportMapLink(report: LitterReport): string {
    if (report.mapLink) {
      return report.mapLink;
    }

    return `https://www.openstreetmap.org/?mlat=${report.lat.toFixed(5)}&mlon=${report.lng.toFixed(5)}#map=17/${report.lat.toFixed(5)}/${report.lng.toFixed(5)}`;
  }

  get litterPickVisibleTiles(): MapTile[] {
    const tileZoom = Math.floor(this.litterPickZoom);
    const tileScale = 2 ** (this.litterPickZoom - tileZoom);
    const center = this.latLngToPixel(this.litterPickCenterLat, this.litterPickCenterLng, tileZoom);
    const leftWorld = center.x - this.litterPickViewportWidth / (2 * tileScale);
    const topWorld = center.y - this.litterPickViewportHeight / (2 * tileScale);
    const firstTileX = Math.floor(leftWorld / this.tileSize);
    const firstTileY = Math.floor(topWorld / this.tileSize);
    const lastTileX = Math.floor((leftWorld + this.litterPickViewportWidth / tileScale) / this.tileSize);
    const lastTileY = Math.floor((topWorld + this.litterPickViewportHeight / tileScale) / this.tileSize);
    const maxTile = 2 ** tileZoom;
    const tiles: MapTile[] = [];

    for (let x = firstTileX; x <= lastTileX; x += 1) {
      for (let y = firstTileY; y <= lastTileY; y += 1) {
        if (y < 0 || y >= maxTile) {
          continue;
        }

        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        const shard = ['a', 'b', 'c'][(wrappedX + y) % 3];
        tiles.push({
          key: `${this.litterPickZoom.toFixed(2)}-${wrappedX}-${y}`,
          url: `https://${shard}.basemaps.cartocdn.com/rastertiles/voyager/${tileZoom}/${wrappedX}/${y}@2x.png`,
          left: (x * this.tileSize - leftWorld) * tileScale,
          top: (y * this.tileSize - topWorld) * tileScale,
          size: this.tileSize * tileScale
        });
      }
    }

    return tiles;
  }

  get litterPickBoundaryPixelPoints(): MapPoint[] {
    return HETHERSETT_BOUNDARY.map((point) => this.latLngToMapPosition(point));
  }

  get litterPickBoundaryPixelPointsAttribute(): string {
    return this.litterPickBoundaryPixelPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  }

  get litterPickMapViewBox(): string {
    return `0 0 ${this.litterPickViewportWidth} ${this.litterPickViewportHeight}`;
  }

  get activeMeetingPointEvent(): LitterPickEvent | null {
    if (this.meetingPointTarget === 'new') {
      return this.newLitterPickEvent;
    }

    return this.draftLitterPickEvent;
  }

  zoomLitterPickMapIn(): void {
    this.litterPickZoom = this.clamp(this.litterPickZoom + 0.35, this.minLitterPickZoom, this.maxLitterPickZoom);
  }

  zoomLitterPickMapOut(): void {
    this.litterPickZoom = this.clamp(this.litterPickZoom - 0.35, this.minLitterPickZoom, this.maxLitterPickZoom);
  }

  resetLitterPickMap(): void {
    this.litterPickCenterLat = 52.5966;
    this.litterPickCenterLng = 1.181;
    this.litterPickZoom = 13.7;
  }

  setLitterPickMapMode(mode: LitterPickMapMode): void {
    this.litterPickMapMode = mode;
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
    if (mode !== 'edit') {
      this.editingAreaId = null;
    }
    if (mode !== 'meeting') {
      this.meetingPointTarget = null;
    }
  }

  startNewTeamArea(): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed' || !this.hasAvailableTeamSticker()) {
      return;
    }

    if (!this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    this.setLitterPickMapMode('draw');
  }

  hasAvailableTeamSticker(): boolean {
    return Boolean(this.draftLitterPickEvent && this.availableTeamStickers(this.draftLitterPickEvent).length);
  }

  startMeetingPointPick(target: MeetingPointTarget): void {
    if (target === 'draft' && (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed')) {
      return;
    }

    if (target === 'draft' && !this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    this.meetingPointTarget = target;
    this.litterPickMapMode = 'meeting';
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
    this.editingAreaId = null;
  }

  clearMeetingPointCoordinates(target: LitterPickEvent): void {
    if (target === this.draftLitterPickEvent) {
      if (target.status === 'closed') {
        return;
      }

      if (!this.isEditingLitterPick) {
        this.isEditingLitterPick = true;
      }
    }

    target.meetingPointLat = undefined;
    target.meetingPointLng = undefined;
    this.errorMessage = '';
    this.statusMessage =
      target === this.draftLitterPickEvent
        ? 'Start coordinates removed. Save changes to keep them removed.'
        : 'Start coordinates removed.';
    this.setLitterPickMapMode('pan');
  }

  toggleLitterPickWorkspaceFullscreen(): void {
    this.litterPickWorkspaceFullscreen = !this.litterPickWorkspaceFullscreen;
    setTimeout(() => this.updateLitterPickViewportSize());
  }

  onLitterPickMapPointerDown(event: PointerEvent): void {
    if (this.isInteractiveTarget(event.target)) {
      return;
    }

    if (this.litterPickMapMode === 'meeting') {
      this.pickMeetingPoint(event);
      return;
    }

    if (this.shouldPanLitterPickMap(event)) {
      this.beginLitterPickMapPan(event);
      return;
    }

    if (this.litterPickMapMode === 'draw') {
      this.beginAreaDraw(event);
    }
  }

  onLitterPickMapPointerMove(event: PointerEvent): void {
    if (this.areaEditDrag) {
      this.updateAreaEditDrag(event);
      return;
    }

    if (this.panState) {
      this.updateLitterPickMapPan(event);
      return;
    }

    this.updateAreaDraw(event);
  }

  onLitterPickMapPointerUp(event: PointerEvent): void {
    if (this.areaEditDrag) {
      this.finishAreaEditDrag(event);
      return;
    }

    if (this.panState) {
      this.finishLitterPickMapPan(event);
      return;
    }

    this.finishAreaDraw(event);
  }

  pickMeetingPoint(event: PointerEvent): void {
    const point = this.mapPointerToLatLng(event);
    const target = this.activeMeetingPointEvent;
    if (!point || !target) {
      return;
    }

    target.meetingPointLat = Number(point.lat.toFixed(5));
    target.meetingPointLng = Number(point.lng.toFixed(5));
    this.errorMessage = '';
    this.statusMessage =
      target === this.draftLitterPickEvent
        ? 'Start coordinates set. Save changes to keep them.'
        : 'Start coordinates set.';
    this.setLitterPickMapMode('pan');
  }

  onLitterPickMapWheel(event: WheelEvent): void {
    event.preventDefault();

    if (!this.litterPickMap?.nativeElement) {
      return;
    }

    const nextZoom = this.clamp(
      this.litterPickZoom + (event.deltaY < 0 ? 0.25 : -0.25),
      this.minLitterPickZoom,
      this.maxLitterPickZoom
    );
    if (nextZoom === this.litterPickZoom) {
      return;
    }

    const rect = this.litterPickMap.nativeElement.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const cursorLatLng = this.mapOffsetToLatLng(cursorX, cursorY);
    const cursorPixelAtNextZoom = this.latLngToPixel(cursorLatLng.lat, cursorLatLng.lng, nextZoom);
    const nextCenterPixel = {
      x: cursorPixelAtNextZoom.x - (cursorX - this.litterPickViewportWidth / 2),
      y: cursorPixelAtNextZoom.y - (cursorY - this.litterPickViewportHeight / 2)
    };
    const nextCenter = this.pixelToLatLng(nextCenterPixel.x, nextCenterPixel.y, nextZoom);

    this.litterPickZoom = nextZoom;
    this.litterPickCenterLat = nextCenter.lat;
    this.litterPickCenterLng = nextCenter.lng;
  }

  beginAreaDraw(event: PointerEvent): void {
    if (!this.draftLitterPickEvent || !this.isEditingLitterPick || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    const point = this.mapPointerToBoundaryPoint(event);
    if (!point || !this.isPointInsideBoundary(point)) {
      return;
    }

    this.dragStart = point;
    this.draftAreaPoints = [point];
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  updateAreaDraw(event: PointerEvent): void {
    if (!this.dragStart || !this.draftAreaPoints.length) {
      return;
    }

    const point = this.mapPointerToBoundaryPoint(event);
    if (!point) {
      return;
    }

    const lastPoint = this.draftAreaPoints[this.draftAreaPoints.length - 1];
    if (this.distanceBetweenPoints(lastPoint, point) >= 0.45) {
      this.draftAreaPoints = [...this.draftAreaPoints, point];
    }
  }

  finishAreaDraw(event: PointerEvent): void {
    if (!this.draftLitterPickEvent || !this.dragStart || !this.draftAreaPoints.length) {
      return;
    }

    const map = event.currentTarget as HTMLElement;
    if (map.hasPointerCapture(event.pointerId)) {
      map.releasePointerCapture(event.pointerId);
    }
    const points = this.simplifyAreaPoints(this.draftAreaPoints);
    this.dragStart = null;
    this.draftAreaPoints = [];

    if (points.length < 3 || this.polygonArea(points) < 1) {
      return;
    }

    const bounds = this.areaBounds(points);
    const sticker = this.randomAvailableSticker(this.draftLitterPickEvent);
    if (!sticker) {
      return;
    }

    const newArea: LitterPickArea = {
      id: this.createId('area'),
      label: `Team ${sticker.label}`,
      points,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      stickerIcon: sticker.icon,
      stickerLabel: sticker.label,
      stickerColor: sticker.color,
      stickerTint: sticker.tint,
      stickerStroke: sticker.stroke,
      bags: 0,
      volunteers: 0,
      notes: ''
    };
    this.draftLitterPickEvent.areas = [...this.draftLitterPickEvent.areas, newArea];
    this.activeAreaId = newArea.id;
    this.litterPickMapMode = 'pan';
  }

  beginLitterPickMapPan(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: this.latLngToPixel(this.litterPickCenterLat, this.litterPickCenterLng, this.litterPickZoom)
    };
  }

  updateLitterPickMapPan(event: PointerEvent): void {
    if (!this.panState || this.panState.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - this.panState.startX;
    const dy = event.clientY - this.panState.startY;
    const nextCenter = this.pixelToLatLng(
      this.panState.startCenter.x - dx,
      this.panState.startCenter.y - dy,
      this.litterPickZoom
    );
    this.litterPickCenterLat = nextCenter.lat;
    this.litterPickCenterLng = nextCenter.lng;
  }

  finishLitterPickMapPan(event: PointerEvent): void {
    if (!this.panState || this.panState.pointerId !== event.pointerId) {
      return;
    }

    const map = event.currentTarget as HTMLElement;
    if (map.hasPointerCapture(event.pointerId)) {
      map.releasePointerCapture(event.pointerId);
    }
    this.panState = undefined;
  }

  cancelAreaDraw(): void {
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
  }

  selectArea(areaId: string): void {
    this.activeAreaId = areaId;
    this.scrollSelectedAreaIntoView(areaId);
  }

  toggleAreaEdit(areaId: string): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    if (this.editingAreaId === areaId) {
      this.setLitterPickMapMode('pan');
      return;
    }

    if (!this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    this.activeAreaId = areaId;
    this.editingAreaId = areaId;
    this.litterPickMapMode = 'edit';
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
    this.scrollSelectedAreaIntoView(areaId);
  }

  beginAreaVertexDrag(event: PointerEvent, areaId: string, pointIndex: number): void {
    this.beginAreaEditDrag(event, areaId, 'vertex', pointIndex);
  }

  beginAreaMoveDrag(event: PointerEvent, areaId: string): void {
    this.beginAreaEditDrag(event, areaId, 'move');
  }

  removeArea(areaId: string): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    this.draftLitterPickEvent.areas = this.draftLitterPickEvent.areas.filter((area) => area.id !== areaId);
    if (this.activeAreaId === areaId) {
      this.activeAreaId = this.draftLitterPickEvent.areas[0]?.id || null;
    }
    if (this.editingAreaId === areaId) {
      this.setLitterPickMapMode('pan');
    }
  }

  totalBags(event: LitterPickEvent): number {
    return event.areas.reduce((total, area) => total + this.safeNumber(area.bags), 0);
  }

  totalVolunteers(event: LitterPickEvent): number {
    return event.areas.reduce((total, area) => total + this.safeNumber(area.volunteers), 0);
  }

  coveragePercent(event: LitterPickEvent): number {
    if (!this.coverageSamplePoints.length) {
      return 0;
    }

    const covered = this.coverageSamplePoints.filter((point) =>
      event.areas.some((area) => this.isPointInsideArea(point, area))
    ).length;

    return Math.round((covered / this.coverageSamplePoints.length) * 100);
  }

  areaCoveragePercent(area: LitterPickArea): number {
    if (!this.coverageSamplePoints.length) {
      return 0;
    }

    const covered = this.coverageSamplePoints.filter((point) => this.isPointInsideArea(point, area)).length;
    return Math.round((covered / this.coverageSamplePoints.length) * 100);
  }

  areaPolygonPointsAttribute(area: LitterPickArea): string {
    return this.areaPoints(area)
      .map((point) => this.boundaryPointToMapPosition(point))
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(' ');
  }

  areaStickerTransform(area: LitterPickArea): string {
    const position = this.boundaryPointToMapPosition(this.areaCentroid(area));
    return `translate(${position.x.toFixed(1)} ${position.y.toFixed(1)})`;
  }

  areaEditHandlePositions(area: LitterPickArea): MapPoint[] {
    return this.areaPoints(area).map((point) => this.boundaryPointToMapPosition(point));
  }

  areaMoveHandlePosition(area: LitterPickArea): MapPoint {
    return this.boundaryPointToMapPosition(this.areaCentroid(area));
  }

  meetingPointMarkerTransform(event: LitterPickEvent | null): string {
    const position = this.latLngToMapPosition(this.meetingPointCoordinate(event));
    return `translate(${position.x.toFixed(1)} ${position.y.toFixed(1)})`;
  }

  hasMeetingPointCoordinates(event: LitterPickEvent | null): boolean {
    return Number.isFinite(Number(event?.meetingPointLat)) && Number.isFinite(Number(event?.meetingPointLng));
  }

  meetingPointDisplay(event: LitterPickEvent | null): string {
    return event?.meetingPoint?.trim() || 'Event start point not set';
  }

  meetingPointCoordinates(event: LitterPickEvent | null): string {
    if (!this.hasMeetingPointCoordinates(event)) {
      return 'Coordinates not set';
    }

    const point = this.meetingPointCoordinate(event);
    return `${point.lat.toFixed(5)}° N, ${point.lng.toFixed(5)}° E`;
  }

  draftAreaPolygonPointsAttribute(): string {
    return this.draftAreaPoints
      .map((point) => this.boundaryPointToMapPosition(point))
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(' ');
  }

  formatLitterPickDate(event: LitterPickEvent): string {
    if (!event.date) {
      return 'Date not set';
    }

    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(`${event.date}T12:00:00`));
  }

  private async createLitterPickReportPdf(event: LitterPickEvent): Promise<Blob> {
    const pages: PdfPage[] = [];
    const pageWidth = 595;
    const pageHeight = 842;
    const leaderboard = this.litterPickLeaderboard(event);
    const reportMap = await this.createReportMapImage(event, leaderboard, 1200, 650);
    const reportLogo = await this.createPdfLogoImage('#123f2a');
    const photoReportLogo = await this.createPdfLogoImage('#f8faf7');
    const eventPhotoImages = (
      await Promise.all((event.photos || []).map((photo, index) => this.createPdfPhotoImage(photo, `EventPhoto${index + 1}`)))
    ).filter((photo): photo is PdfImageResource => Boolean(photo));
    const addPage = (): PdfPage => {
      const page: PdfPage = { commands: ['1 J 1 j'], images: [] };
      pages.push(page);
      return page;
    };

    const cover = addPage();
    this.addPdfRect(cover.commands, 0, 0, pageWidth, pageHeight, '#fbf8ef', '#fbf8ef', 0);
    this.addPdfRect(cover.commands, 0, 706, pageWidth, 136, '#123f2a', '#123f2a', 0);
    this.addPdfText(cover.commands, 'Hethersett Litter Pick Results', 48, 792, 24, { bold: true, color: '#ffffff' });
    this.addPdfText(cover.commands, 'Thank you to everyone who helped keep Hethersett cleaner.', 48, 764, 12, {
      color: '#eef6ef'
    });
    this.addPdfText(cover.commands, `${this.formatLitterPickDate(event)}  |  ${this.formatTimeRange(event)}`, 48, 740, 10, {
      color: '#dbe9df'
    });
    this.addPdfText(cover.commands, 'Every team area below represents local people giving their time for the village.', 48, 716, 9, {
      color: '#dbe9df'
    });
    if (reportLogo) {
      cover.images.push(reportLogo);
      this.addPdfImage(cover.commands, reportLogo.name, { x: 442, y: 728, width: 104, height: 76 });
    }

    const stats = [
      { label: 'Bags collected', value: String(this.totalBags(event)) },
      { label: 'Volunteers', value: String(this.totalVolunteers(event)) },
      { label: 'Hethersett covered', value: `${this.coveragePercent(event)}%` },
      { label: 'Teams', value: String(event.areas.length) }
    ];
    stats.forEach((stat, index) => {
      this.addPdfStatCard(cover.commands, 48 + index * 124, 642, 108, 56, stat.label, stat.value);
    });

    this.addPdfText(cover.commands, 'Where teams helped', 48, 616, 13, { bold: true, color: '#123f2a' });
    const mapRect = { x: 48, y: 340, width: 500, height: 260 };
    if (reportMap) {
      cover.images.push(reportMap);
      this.addPdfImage(cover.commands, reportMap.name, mapRect);
      this.addPdfRect(cover.commands, mapRect.x, mapRect.y, mapRect.width, mapRect.height, '#ffffff', '#cfe0d4', 0.8, false);
    } else {
      this.addPdfCoverageMap(cover.commands, event, leaderboard, mapRect);
    }

    this.addPdfText(cover.commands, 'Team leaderboard', 48, 306, 13, { bold: true, color: '#123f2a' });
    if (leaderboard.length) {
      leaderboard.slice(0, 3).forEach((row, index) => {
        const y = 276 - index * 34;
        this.addPdfRect(cover.commands, 48, y - 12, 500, 26, row.area.stickerTint || '#f5f7f4', row.area.stickerStroke || '#123f2a', 0.5);
        this.addPdfMedal(cover.commands, 68, y + 1, row.rank);
        this.addPdfText(cover.commands, this.pdfSafeTeamLabel(row.area), 104, y - 3, 10, { bold: true });
        this.addPdfText(cover.commands, `${row.bags} bags`, 350, y - 3, 10);
        this.addPdfText(cover.commands, `${Math.round(row.coverage * 100)}% covered`, 430, y - 3, 10);
      });
    } else {
      this.addPdfText(cover.commands, 'No team coverage areas have been added yet.', 48, 280, 10);
    }

    this.addPdfRect(cover.commands, 48, 92, 500, 56, '#edf6ef', '#cfe0d4', 0.6);
    this.addPdfText(
      cover.commands,
      'Want to help next time? Join the next community litter pick and bring a friend.',
      48,
      128,
      12,
      { bold: true, color: '#123f2a' }
    );
    this.addPdfText(cover.commands, 'Small actions add up fast when the whole village gets involved.', 48, 108, 9, {
      color: '#55655d'
    });
    this.addPdfText(cover.commands, 'Leaderboard ranks by bags collected, then covered area when bag totals match.', 48, 58, 8, {
      color: '#55655d'
    });

    if (eventPhotoImages.length) {
      let photoPage = addPage();
      this.addPdfPhotoHeader(photoPage, event, photoReportLogo || reportLogo);
      let slot = 0;
      eventPhotoImages.forEach((photo) => {
        if (slot >= 4) {
          photoPage = addPage();
          this.addPdfPhotoHeader(photoPage, event, photoReportLogo || reportLogo);
          slot = 0;
        }

        photoPage.images.push(photo);
        const col = slot % 2;
        const row = Math.floor(slot / 2);
        const frame = { x: 48 + col * 256, y: 414 - row * 286, width: 226, height: 244 };
        this.addPdfPhotoCard(photoPage.commands, photo, frame);
        slot += 1;
      });
    }

    if (leaderboard.length) {
      let page = addPage();
      let y = 778;
      let pageNumber = 1;
      this.addPdfLeaderboardHeader(page.commands, pageNumber);
      y = 728;

      leaderboard.forEach((row) => {
        if (y < 76) {
          page = addPage();
          pageNumber += 1;
          this.addPdfLeaderboardHeader(page.commands, pageNumber);
          y = 728;
        }

        this.addPdfLeaderboardRow(page.commands, row, y);
        y -= 26;
      });
    }

    return this.buildPdfDocument(pages, pageWidth, pageHeight);
  }

  private async createReportMapImage(
    event: LitterPickEvent,
    leaderboard: LitterPickLeaderboardRow[],
    width: number,
    height: number
  ): Promise<PdfImageResource | null> {
    if (typeof document === 'undefined') {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    const bounds = this.boundaryBounds();
    const boundaryPixelsAtZero = HETHERSETT_BOUNDARY.map((point) => this.latLngToPixel(point.lat, point.lng, 0));
    const minX = Math.min(...boundaryPixelsAtZero.map((point) => point.x));
    const maxX = Math.max(...boundaryPixelsAtZero.map((point) => point.x));
    const minY = Math.min(...boundaryPixelsAtZero.map((point) => point.y));
    const maxY = Math.max(...boundaryPixelsAtZero.map((point) => point.y));
    const fitScale = Math.min((width - 120) / (maxX - minX), (height - 100) / (maxY - minY));
    const zoom = this.clamp(Math.log2(fitScale) - 0.08, this.minLitterPickZoom, this.maxLitterPickZoom);
    const tileZoom = Math.floor(zoom);
    const tileScale = 2 ** (zoom - tileZoom);
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const center = this.latLngToPixel(centerLat, centerLng, tileZoom);
    const leftWorld = center.x - width / (2 * tileScale);
    const topWorld = center.y - height / (2 * tileScale);
    const firstTileX = Math.floor(leftWorld / this.tileSize);
    const firstTileY = Math.floor(topWorld / this.tileSize);
    const lastTileX = Math.floor((leftWorld + width / tileScale) / this.tileSize);
    const lastTileY = Math.floor((topWorld + height / tileScale) / this.tileSize);
    const maxTile = 2 ** tileZoom;
    const tiles: Array<{ url: string; left: number; top: number; size: number }> = [];

    for (let x = firstTileX; x <= lastTileX; x += 1) {
      for (let y = firstTileY; y <= lastTileY; y += 1) {
        if (y < 0 || y >= maxTile) {
          continue;
        }

        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        const shard = ['a', 'b', 'c'][(wrappedX + y) % 3];
        tiles.push({
          url: `https://${shard}.basemaps.cartocdn.com/rastertiles/voyager/${tileZoom}/${wrappedX}/${y}@2x.png`,
          left: (x * this.tileSize - leftWorld) * tileScale,
          top: (y * this.tileSize - topWorld) * tileScale,
          size: this.tileSize * tileScale
        });
      }
    }

    const loadedTiles = await Promise.allSettled(
      tiles.map(async (tile) => ({ ...tile, image: await this.loadReportMapTile(tile.url) }))
    );
    const drawableTiles = loadedTiles
      .filter((result): result is PromiseFulfilledResult<{ url: string; left: number; top: number; size: number; image: HTMLImageElement }> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (!drawableTiles.length) {
      return null;
    }

    context.fillStyle = '#f7faf6';
    context.fillRect(0, 0, width, height);
    drawableTiles.forEach((tile) => {
      context.drawImage(tile.image, tile.left, tile.top, tile.size, tile.size);
    });

    const toCanvas = (coordinate: BoundaryCoordinate): MapPoint => {
      const pixel = this.latLngToPixel(coordinate.lat, coordinate.lng, tileZoom);
      return {
        x: (pixel.x - center.x) * tileScale + width / 2,
        y: (pixel.y - center.y) * tileScale + height / 2
      };
    };
    const drawPath = (points: MapPoint[]): void => {
      if (!points.length) {
        return;
      }

      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
    };

    const rankByAreaId = new Map(leaderboard.map((row) => [row.area.id, row.rank]));
    event.areas.forEach((area) => {
      const points = this.areaPoints(area).map((point) => toCanvas(this.boundaryPointToLatLng(point)));
      if (points.length < 3) {
        return;
      }

      context.save();
      context.globalAlpha = 0.62;
      drawPath(points);
      context.fillStyle = area.stickerTint || '#f7faf6';
      context.fill();
      context.restore();
      context.strokeStyle = area.stickerStroke || '#8b5f3d';
      context.lineWidth = 4;
      context.setLineDash([10, 7]);
      drawPath(points);
      context.stroke();
      context.setLineDash([]);

      const centroid = toCanvas(this.boundaryPointToLatLng(this.areaCentroid(area)));
      context.beginPath();
      context.arc(centroid.x, centroid.y, 22, 0, Math.PI * 2);
      context.fillStyle = area.stickerTint || '#ffffff';
      context.fill();
      context.lineWidth = 4;
      context.strokeStyle = area.stickerStroke || '#123f2a';
      context.stroke();
      context.font = '24px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#123f2a';
      context.fillText(area.stickerIcon || String(rankByAreaId.get(area.id) || ''), centroid.x, centroid.y + 1);
    });

    try {
      return {
        name: 'Map1',
        width,
        height,
        data: this.dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.9))
      };
    } catch {
      return null;
    }
  }

  private async createPdfLogoImage(background: string): Promise<PdfImageResource | null> {
    try {
      const image = await this.loadReportMapTile('assets/images/hhh-oval-logo.png');
      const scanCanvas = document.createElement('canvas');
      scanCanvas.width = image.naturalWidth || image.width;
      scanCanvas.height = image.naturalHeight || image.height;
      const scanContext = scanCanvas.getContext('2d');
      if (!scanContext) {
        return null;
      }

      scanContext.drawImage(image, 0, 0);
      const imageData = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      let minX = scanCanvas.width;
      let minY = scanCanvas.height;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < scanCanvas.height; y += 1) {
        for (let x = 0; x < scanCanvas.width; x += 1) {
          const alpha = imageData.data[(y * scanCanvas.width + x) * 4 + 3];
          if (alpha > 12) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }

      if (minX > maxX || minY > maxY) {
        return null;
      }

      const padding = 8;
      const sourceX = Math.max(0, minX - padding);
      const sourceY = Math.max(0, minY - padding);
      const sourceWidth = Math.min(scanCanvas.width - sourceX, maxX - minX + padding * 2);
      const sourceHeight = Math.min(scanCanvas.height - sourceY, maxY - minY + padding * 2);
      const canvas = document.createElement('canvas');
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }

      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(scanCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

      return {
        name: 'ReportLogo',
        width: canvas.width,
        height: canvas.height,
        data: this.dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92))
      };
    } catch {
      return null;
    }
  }

  private async createPdfPhotoImage(photo: PhotoAttachment, name: string): Promise<PdfImageResource | null> {
    try {
      const image = await this.loadReportMapTile(photo.dataUrl);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return {
        name,
        width,
        height,
        data: this.dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.88))
      };
    } catch {
      return null;
    }
  }

  private addPdfCoverageMap(
    commands: string[],
    event: LitterPickEvent,
    leaderboard: LitterPickLeaderboardRow[],
    rect: PdfRect
  ): void {
    this.addPdfRect(commands, rect.x, rect.y, rect.width, rect.height, '#f7faf6', '#cfe0d4', 0.8);

    const rankByAreaId = new Map(leaderboard.map((row) => [row.area.id, row.rank]));
    event.areas.forEach((area) => {
      const points = this.areaPoints(area);
      if (points.length < 3) {
        return;
      }

      this.addPdfPolygon(commands, points, rect, area.stickerTint || '#edf3ea', area.stickerStroke || '#8b5f3d', 1);
      const centroid = this.pdfMapPoint(this.areaCentroid(area), rect);
      this.addPdfCircle(commands, centroid.x, centroid.y, 9, area.stickerColor || '#f2c94c', area.stickerStroke || '#123f2a', 0.8);
      const rank = String(rankByAreaId.get(area.id) || '');
      this.addPdfText(commands, rank, centroid.x - (rank.length > 1 ? 5 : 2.5), centroid.y - 3, 8, {
        bold: true,
        color: '#ffffff'
      });
    });
  }

  private addPdfMapLegend(commands: string[], rows: LitterPickLeaderboardRow[], x: number, y: number): void {
    this.addPdfText(commands, 'Map key', x, y + 22, 11, { bold: true, color: '#123f2a' });
    if (!rows.length) {
      this.addPdfText(commands, 'No teams yet.', x, y, 9);
      return;
    }

    rows.forEach((row, index) => {
      const rowY = y - index * 18;
      this.addPdfCircle(commands, x + 6, rowY, 5, row.area.stickerColor || '#f2c94c', row.area.stickerStroke || '#123f2a', 0.6);
      this.addPdfText(commands, `${row.rank}. ${this.pdfSafeTeamLabel(row.area)}`, x + 18, rowY - 3, 8);
    });

    if (rows.length === 10) {
      this.addPdfText(commands, 'Full leaderboard follows.', x, y - 190, 8, { color: '#55655d' });
    }
  }

  private addPdfLeaderboardHeader(commands: string[], pageNumber: number): void {
    this.addPdfText(commands, `Leaderboard${pageNumber > 1 ? `, continued ${pageNumber}` : ''}`, 48, 792, 20, {
      bold: true,
      color: '#123f2a'
    });
    this.addPdfText(commands, 'Rank', 52, 746, 9, { bold: true });
    this.addPdfText(commands, 'Team', 118, 746, 9, { bold: true });
    this.addPdfText(commands, 'Bags', 316, 746, 9, { bold: true });
    this.addPdfText(commands, 'Volunteers', 374, 746, 9, { bold: true });
    this.addPdfText(commands, 'Covered', 466, 746, 9, { bold: true });
    this.addPdfRect(commands, 48, 736, 500, 1, '#dce8df', '#dce8df', 0);
  }

  private addPdfPhotoHeader(page: PdfPage, event: LitterPickEvent, logo?: PdfImageResource | null): void {
    const { commands } = page;
    this.addPdfRect(commands, 0, 0, 595, 842, '#f8faf7', '#f8faf7', 0);
    this.addPdfRect(commands, 48, 762, 5, 46, '#4f9968', '#4f9968', 0);
    this.addPdfText(commands, 'Event photos', 66, 792, 24, { bold: true, color: '#123f2a' });
    this.addPdfText(commands, event.title || 'Litter pick event', 66, 768, 10, { color: '#55655d' });
    this.addPdfText(commands, `${this.formatLitterPickDate(event)}  |  ${this.formatTimeRange(event)}`, 66, 748, 8, {
      color: '#7b8a82'
    });
    this.addPdfRect(commands, 48, 720, 500, 1, '#dce8df', '#dce8df', 0);
    if (logo) {
      page.images.push(logo);
      this.addPdfImage(commands, logo.name, { x: 438, y: 752, width: 104, height: 76 });
    }
  }

  private addPdfPhotoCard(commands: string[], photo: PdfImageResource, frame: PdfRect): void {
    const imageFrame = {
      x: frame.x + 10,
      y: frame.y + 10,
      width: frame.width - 20,
      height: frame.height - 20
    };
    this.addPdfRect(commands, frame.x, frame.y, frame.width, frame.height, '#ffffff', '#d8e5dc', 0.55);
    this.addPdfRect(commands, imageFrame.x, imageFrame.y, imageFrame.width, imageFrame.height, '#f3f7f4', '#edf3ef', 0.35);
    this.addPdfImage(commands, photo.name, this.pdfContainedRect(photo, imageFrame));
  }

  private addPdfLeaderboardRow(commands: string[], row: LitterPickLeaderboardRow, y: number): void {
    this.addPdfRect(commands, 48, y - 10, 500, 22, row.area.stickerTint || '#f7faf6', '#e2ece5', 0.3);
    this.addPdfCircle(commands, 62, y, 5.5, row.area.stickerColor || '#f2c94c', row.area.stickerStroke || '#123f2a', 0.5);
    if (row.rank <= 3) {
      this.addPdfMedal(commands, 89, y, row.rank);
    } else {
      this.addPdfText(commands, `#${row.rank}`, 80, y - 3, 8, { bold: true });
    }
    this.addPdfText(commands, this.pdfSafeTeamLabel(row.area), 118, y - 3, 8, { bold: true });
    this.addPdfText(commands, String(row.bags), 316, y - 3, 8);
    this.addPdfText(commands, String(row.volunteers), 374, y - 3, 8);
    this.addPdfText(commands, `${Math.round(row.coverage * 100)}%`, 466, y - 3, 8);
  }

  private addPdfStatCard(commands: string[], x: number, y: number, width: number, height: number, label: string, value: string): void {
    this.addPdfRect(commands, x, y, width, height, '#f7faf6', '#d7e4da', 0.8);
    this.addPdfText(commands, value, x + 12, y + 24, 18, { bold: true, color: '#123f2a' });
    this.addPdfText(commands, label, x + 12, y + 10, 8, { color: '#55655d' });
  }

  private addPdfText(
    commands: string[],
    text: string,
    x: number,
    y: number,
    size: number,
    options: { bold?: boolean; color?: string } = {}
  ): void {
    commands.push(`${this.pdfColor(options.color || '#1d2b24')} rg BT /F${options.bold ? 2 : 1} ${size} Tf ${this.pdfNumber(x)} ${this.pdfNumber(y)} Td (${this.escapePdfText(text)}) Tj ET`);
  }

  private addPdfRect(
    commands: string[],
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    stroke: string,
    strokeWidth: number,
    fillShape = true
  ): void {
    const paint = fillShape ? 'B' : 'S';
    commands.push(
      `${this.pdfColor(fill)} rg ${this.pdfColor(stroke)} RG ${this.pdfNumber(strokeWidth)} w ${this.pdfNumber(x)} ${this.pdfNumber(y)} ${this.pdfNumber(width)} ${this.pdfNumber(height)} re ${paint}`
    );
  }

  private addPdfImage(commands: string[], imageName: string, rect: PdfRect): void {
    commands.push(
      `q ${this.pdfNumber(rect.width)} 0 0 ${this.pdfNumber(rect.height)} ${this.pdfNumber(rect.x)} ${this.pdfNumber(rect.y)} cm /${imageName} Do Q`
    );
  }

  private pdfContainedRect(image: PdfImageResource, frame: PdfRect): PdfRect {
    const imageRatio = image.width / image.height;
    const frameRatio = frame.width / frame.height;
    if (imageRatio > frameRatio) {
      const height = frame.width / imageRatio;
      return {
        x: frame.x,
        y: frame.y + (frame.height - height) / 2,
        width: frame.width,
        height
      };
    }

    const width = frame.height * imageRatio;
    return {
      x: frame.x + (frame.width - width) / 2,
      y: frame.y,
      width,
      height: frame.height
    };
  }

  private addPdfCircle(
    commands: string[],
    x: number,
    y: number,
    radius: number,
    fill: string,
    stroke: string,
    strokeWidth: number
  ): void {
    commands.push(
      `${this.pdfColor(fill)} rg ${this.pdfColor(stroke)} RG ${this.pdfNumber(strokeWidth)} w ${this.pdfCirclePath(x, y, radius)} B`
    );
  }

  private addPdfMedal(commands: string[], x: number, y: number, rank: number): void {
    const medal = this.pdfMedalColors(rank);
    commands.push(`${this.pdfColor(medal.ribbon)} rg ${this.pdfNumber(x - 7)} ${this.pdfNumber(y - 17)} 5 12 re f`);
    commands.push(`${this.pdfColor(medal.ribbon)} rg ${this.pdfNumber(x + 2)} ${this.pdfNumber(y - 17)} 5 12 re f`);
    this.addPdfCircle(commands, x, y, 10, medal.fill, medal.stroke, 0.8);
    this.addPdfText(commands, String(rank), x - (rank > 9 ? 5 : 2.5), y - 3.2, 8, {
      bold: true,
      color: rank <= 3 ? '#ffffff' : '#123f2a'
    });
  }

  private pdfMedalColors(rank: number): { fill: string; stroke: string; ribbon: string } {
    if (rank === 1) {
      return { fill: '#d9a625', stroke: '#8b6814', ribbon: '#b7472f' };
    }
    if (rank === 2) {
      return { fill: '#a7b1b7', stroke: '#68747c', ribbon: '#3d6d95' };
    }
    if (rank === 3) {
      return { fill: '#b46a3c', stroke: '#7b4224', ribbon: '#5f8d5b' };
    }
    return { fill: '#f7faf6', stroke: '#cfe0d4', ribbon: '#cfe0d4' };
  }

  private addPdfPolygon(
    commands: string[],
    points: MapPoint[],
    rect: PdfRect,
    fill: string,
    stroke: string,
    strokeWidth: number
  ): void {
    if (points.length < 3) {
      return;
    }

    const [first, ...rest] = points.map((point) => this.pdfMapPoint(point, rect));
    const path = [
      `${this.pdfNumber(first.x)} ${this.pdfNumber(first.y)} m`,
      ...rest.map((point) => `${this.pdfNumber(point.x)} ${this.pdfNumber(point.y)} l`),
      'h'
    ].join(' ');
    commands.push(`${this.pdfColor(fill)} rg ${this.pdfColor(stroke)} RG ${this.pdfNumber(strokeWidth)} w ${path} B`);
  }

  private pdfMapPoint(point: MapPoint, rect: PdfRect): MapPoint {
    return {
      x: rect.x + (point.x / 100) * rect.width,
      y: rect.y + rect.height - (point.y / 100) * rect.height
    };
  }

  private pdfCirclePath(x: number, y: number, radius: number): string {
    const control = radius * 0.5522847498;
    return [
      `${this.pdfNumber(x + radius)} ${this.pdfNumber(y)} m`,
      `${this.pdfNumber(x + radius)} ${this.pdfNumber(y + control)} ${this.pdfNumber(x + control)} ${this.pdfNumber(y + radius)} ${this.pdfNumber(x)} ${this.pdfNumber(y + radius)} c`,
      `${this.pdfNumber(x - control)} ${this.pdfNumber(y + radius)} ${this.pdfNumber(x - radius)} ${this.pdfNumber(y + control)} ${this.pdfNumber(x - radius)} ${this.pdfNumber(y)} c`,
      `${this.pdfNumber(x - radius)} ${this.pdfNumber(y - control)} ${this.pdfNumber(x - control)} ${this.pdfNumber(y - radius)} ${this.pdfNumber(x)} ${this.pdfNumber(y - radius)} c`,
      `${this.pdfNumber(x + control)} ${this.pdfNumber(y - radius)} ${this.pdfNumber(x + radius)} ${this.pdfNumber(y - control)} ${this.pdfNumber(x + radius)} ${this.pdfNumber(y)} c`
    ].join(' ');
  }

  private loadReportMapTile(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load map tile ${url}`));
      image.src = url;
    });
  }

  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  private buildPdfDocument(pages: PdfPage[], pageWidth: number, pageHeight: number): Blob {
    const encoder = new TextEncoder();
    const objects: Array<Array<string | Uint8Array>> = [
      ['<< /Type /Catalog /Pages 2 0 R >>'],
      [''],
      ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
      ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']
    ];
    const kids: number[] = [];

    pages.forEach((page, index) => {
      const contentObjectId = objects.length + 1;
      const content = page.commands.join('\n');
      const contentBytes = encoder.encode(content);
      objects.push([`<< /Length ${contentBytes.byteLength} >>\nstream\n`, contentBytes, '\nendstream']);
      const imageResources = page.images.map((image) => {
        const imageObjectId = objects.length + 1;
        objects.push([
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.byteLength} >>\nstream\n`,
          image.data,
          '\nendstream'
        ]);
        return { name: image.name, objectId: imageObjectId };
      });
      const xObjects = imageResources.length
        ? ` /XObject << ${imageResources.map((image) => `/${image.name} ${image.objectId} 0 R`).join(' ')} >>`
        : '';
      const pageObjectId = objects.length + 1;
      kids.push(pageObjectId);
      objects.push([
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjects} >> /Contents ${contentObjectId} 0 R >>`
      ]);
    });

    objects[1] = [`<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${pages.length} >>`];

    const parts: Array<string | Uint8Array> = [];
    const offsets = [0];
    let byteLength = 0;
    const append = (part: string | Uint8Array): void => {
      parts.push(part);
      byteLength += typeof part === 'string' ? encoder.encode(part).byteLength : part.byteLength;
    };

    append('%PDF-1.4\n');
    objects.forEach((objectParts, index) => {
      offsets.push(byteLength);
      append(`${index + 1} 0 obj\n`);
      objectParts.forEach((part) => append(part));
      append('\nendobj\n');
    });
    const xrefOffset = byteLength;
    append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach((offset) => {
      append(`${String(offset).padStart(10, '0')} 00000 n \n`);
    });
    append(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return new Blob(parts, { type: 'application/pdf' });
  }

  private litterPickLeaderboard(event: LitterPickEvent): LitterPickLeaderboardRow[] {
    const rows = event.areas.map((area, index) => ({
      rank: index + 1,
      medal: '',
      area,
      bags: this.safeNumber(area.bags),
      volunteers: this.safeNumber(area.volunteers),
      coverage: this.areaCoverageRatio(area),
      originalIndex: index
    }));

    rows.sort(
      (a, b) =>
        b.bags - a.bags ||
        b.coverage - a.coverage ||
        this.pdfSafeTeamLabel(a.area).localeCompare(this.pdfSafeTeamLabel(b.area)) ||
        a.originalIndex - b.originalIndex
    );

    const medals = ['Gold', 'Silver', 'Bronze'];
    return rows.map((row, index) => ({
      ...row,
      rank: index + 1,
      medal: medals[index] || `#${index + 1}`
    }));
  }

  private areaCoverageRatio(area: LitterPickArea): number {
    if (!this.coverageSamplePoints.length) {
      return 0;
    }

    const covered = this.coverageSamplePoints.filter((point) => this.isPointInsideArea(point, area)).length;
    return covered / this.coverageSamplePoints.length;
  }

  private formatTimeRange(event: LitterPickEvent): string {
    const start = event.start?.trim();
    const end = event.end?.trim();
    if (start && end) {
      return `${start} to ${end}`;
    }
    return start || end || 'Not set';
  }

  private pdfSafeTeamLabel(area: LitterPickArea): string {
    return area.label?.trim() || `Team ${area.stickerLabel || 'Unnamed'}`;
  }

  private escapePdfText(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private pdfColor(hex: string): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    const value = match?.[1] || '1d2b24';
    const channels = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((channel) =>
      this.pdfNumber(parseInt(channel, 16) / 255)
    );
    return channels.join(' ');
  }

  private pdfNumber(value: number): string {
    return Number(value.toFixed(3)).toString();
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'litter-pick-event';
  }

  private loadEvents(): void {
    this.events = this.sortLatestFirst(this.eventsService.getSnapshot());
  }

  private loadReports(): void {
    this.reportsLoading = true;
    this.reportsError = '';

    this.litterReportsService.loadReports().subscribe({
      next: (reports) => {
        this.reports = reports;
        this.reportsLoading = false;
      },
      error: () => {
        this.reportsError = 'Unable to load litter reports.';
        this.reportsLoading = false;
      }
    });
  }

  private loadFeedbackMessages(): void {
    this.feedbackLoading = true;
    this.feedbackError = '';

    this.feedbackService.loadFeedback().subscribe({
      next: (messages) => {
        this.feedbackMessages = messages;
        this.feedbackLoading = false;
      },
      error: () => {
        this.feedbackError = 'Unable to load feedback messages.';
        this.feedbackLoading = false;
      }
    });
  }

  loadUsers(): void {
    if (!this.canManageUsers) {
      return;
    }

    this.usersLoading = true;
    this.usersError = '';

    this.authService.loadUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.pendingUserRoles = users.reduce<Record<string, 'Admin' | 'Editor'>>((roles, user) => {
          roles[user.id] = this.userRole(user) as 'Admin' | 'Editor';
          return roles;
        }, {});
        this.pendingUserDisabled = users.reduce<Record<string, boolean>>((states, user) => {
          states[user.id] = user.isDisabled;
          return states;
        }, {});
        this.usersLoading = false;
      },
      error: () => {
        this.usersError = 'Unable to load users.';
        this.usersLoading = false;
      }
    });
  }

  loadLitterPickEvents(): void {
    this.litterPicksLoading = true;
    this.litterPicksError = '';

    this.litterPickEventsService.loadEvents().subscribe({
      next: (events) => {
        this.litterPickEvents = events;
        this.litterPicksLoading = false;
      },
      error: () => {
        this.litterPicksError = 'Unable to load litter pick events.';
        this.litterPicksLoading = false;
      }
    });
  }

  private saveEvents(
    updated: EventItem[],
    successMessage: string,
    afterSave?: () => void
  ): void {
    this.eventsService.setEvents(updated.map((event) => this.cloneEvent(event))).subscribe({
      next: (events) => {
        this.events = this.sortLatestFirst(events);
        this.statusMessage = successMessage;
        if (afterSave) {
          afterSave();
        }
      },
      error: () => {
        this.errorMessage = 'Unable to save changes. Check the server or password.';
      }
    });
  }

  private saveLitterPickEvents(
    updated: LitterPickEvent[],
    successMessage: string,
    afterSave?: (events: LitterPickEvent[]) => void
  ): void {
    this.litterPickEventsService.setEvents(updated).subscribe({
      next: (events) => {
        this.litterPickEvents = events;
        this.statusMessage = successMessage;
        this.litterPicksError = '';
        if (afterSave) {
          afterSave(events);
        }
      },
      error: () => {
        this.errorMessage = 'Unable to save litter pick events. Check the server or password.';
      }
    });
  }

  private updateUser(
    user: ManagedUser,
    changes: Partial<{ displayName: string; roles: string[]; isDisabled: boolean }>
  ): void {
    this.usersError = '';
    this.statusMessage = '';
    this.authService
      .updateUser(user.id, {
        displayName: changes.displayName ?? user.displayName,
        roles: changes.roles ?? user.roles,
        isDisabled: changes.isDisabled ?? user.isDisabled
      })
      .subscribe({
        next: (updated) => {
          this.users = this.users.map((item) => (item.id === updated.id ? updated : item));
          this.pendingUserRoles[updated.id] = this.userRole(updated) as 'Admin' | 'Editor';
          this.statusMessage = `Updated ${updated.email}.`;
        },
        error: () => {
          this.usersError = 'Unable to update user.';
        }
      });
  }

  private emptyUserForm(): { email: string; displayName: string; password: string; role: 'Admin' | 'Editor' } {
    return {
      email: '',
      displayName: '',
      password: '',
      role: 'Editor'
    };
  }

  private emptyEvent(): EventItem {
    return {
      id: this.createId('event'),
      title: '',
      date: '',
      start: '',
      end: '',
      location: '',
      description: '',
      ctaLabel: '',
      ctaHref: '',
      note: '',
      phone: '',
      imageUrl: '',
      imageAlt: '',
      photos: []
    };
  }

  private cloneEvent(event: EventItem): EventItem {
    const photos = (event.photos || []).map((photo) => ({ ...photo }));
    if (!photos.length && this.isDataUrl(event.imageUrl)) {
      photos.push({
        fileName: event.imageAlt?.trim() || event.title?.trim() || 'event-photo',
        contentType: this.dataUrlContentType(event.imageUrl) || 'image/jpeg',
        dataUrl: event.imageUrl || ''
      });
    }

    return {
      ...event,
      id: event.id || this.createId('event'),
      ctaLabel: '',
      ctaHref: '',
      imageUrl: this.isDataUrl(event.imageUrl) ? '' : event.imageUrl || '',
      imageAlt: event.imageAlt || '',
      photos
    };
  }

  private isDataUrl(value?: string): boolean {
    return Boolean(value && value.startsWith('data:'));
  }

  private dataUrlContentType(value?: string): string | null {
    const match = /^data:([^;,]+)[;,]/.exec(value || '');
    return match?.[1] || null;
  }

  private emptyLitterPickEvent(): LitterPickEvent {
    const start = new Date();
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    return {
      id: '',
      title: 'Community litter pick',
      date: this.todayInputValue(),
      start: this.timeInputValue(start),
      end: this.timeInputValue(end),
      description: 'Join neighbours for a friendly community litter pick around Hethersett. Bags and litter pickers will be provided.',
      meetingPoint: this.defaultMeetingPoint.label,
      meetingPointLat: undefined,
      meetingPointLng: undefined,
      accessibilityNotes: '',
      weatherPlan: 'If the weather is unsafe, we will rearrange the session.',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      notes: '',
      status: 'open',
      areas: [],
      photos: []
    };
  }

  private isEventValid(event: EventItem): boolean {
    return !(['title', 'date', 'start', 'end', 'description'] as EventRequiredField[]).some((field) =>
      this.isEventFieldMissing(event, field)
    );
  }

  isEventFieldMissing(event: EventItem | null | undefined, field: EventRequiredField): boolean {
    return !String(event?.[field] || '').trim();
  }

  private isLitterPickEventValid(event: LitterPickEvent): boolean {
    return (
      !(['date', 'start', 'end', 'meetingPoint'] as LitterPickRequiredField[]).some((field) =>
        this.isLitterPickFieldMissing(event, field)
      ) && !this.isLitterPickContactEmailInvalid(event)
    );
  }

  isLitterPickFieldMissing(event: LitterPickEvent | null | undefined, field: LitterPickRequiredField): boolean {
    return !String(event?.[field] || '').trim();
  }

  isLitterPickContactEmailInvalid(event: LitterPickEvent | null | undefined): boolean {
    const email = event?.contactEmail?.trim();
    return Boolean(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  private litterPickValidationMessage(action: 'creating' | 'saving'): string {
    const suffix = action === 'creating' ? 'creating the litter pick event' : 'saving';
    if (this.isLitterPickContactEmailInvalid(action === 'creating' ? this.newLitterPickEvent : this.draftLitterPickEvent)) {
      return `Please enter a valid contact email address before ${suffix}.`;
    }

    return `Please complete the highlighted fields before ${suffix}.`;
  }

  private sortLatestFirst(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`));
  }

  private openLitterPickDraft(index: number, editing: boolean): void {
    if (index < 0) {
      return;
    }

    this.expandedLitterPickIndex = index;
    this.draftLitterPickEvent = this.cloneLitterPickEvent(this.litterPickEvents[index]);
    this.isEditingLitterPick = editing && this.draftLitterPickEvent.status === 'open';
    this.litterPickPhotoChangePending = false;
    this.litterPickEditAttempted = false;
    this.litterPickMapMode = 'pan';
    this.activeAreaId = this.draftLitterPickEvent.areas[0]?.id || null;
  }

  private markLitterPickPhotoChangesPending(target: LitterPickEvent): void {
    if (this.draftLitterPickEvent && target === this.draftLitterPickEvent) {
      this.litterPickPhotoChangePending = true;
    }
  }

  private cloneLitterPickEvent(event: LitterPickEvent): LitterPickEvent {
    const usedStickerLabels = new Set<string>();
    const hasCoordinates =
      Number.isFinite(Number(event.meetingPointLat)) && Number.isFinite(Number(event.meetingPointLng));
    const legacyContactPhone = event.contactPhone?.trim() || '';
    const legacyContactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legacyContactPhone) ? legacyContactPhone : '';

    return {
      ...event,
      title: this.litterPickTitleFor(event),
      description: event.description || '',
      meetingPoint: event.meetingPoint?.trim() || '',
      meetingPointLat: hasCoordinates ? Number(event.meetingPointLat) : undefined,
      meetingPointLng: hasCoordinates ? Number(event.meetingPointLng) : undefined,
      capacity: undefined,
      registeredCount: this.safeNumber(event.registeredCount),
      whatToBring: '',
      equipmentProvided: 'Bags and litter pickers will be provided.',
      difficulty: '',
      familyFriendly: undefined,
      accessibilityNotes: event.accessibilityNotes || '',
      weatherPlan: event.weatherPlan || '',
      contactName: event.contactName || '',
      contactEmail: event.contactEmail || legacyContactEmail,
      contactPhone: '',
      bagsGoal: undefined,
      volunteersGoal: undefined,
      photos: (event.photos || []).map((photo) => ({ ...photo })),
      areas: (event.areas || []).map((area, index) => {
        const existingSticker = this.findStickerForArea(area);
        const sticker =
          existingSticker && !usedStickerLabels.has(existingSticker.label)
            ? existingSticker
            : this.randomStickerFrom(this.teamStickers.filter((item) => !usedStickerLabels.has(item.label))) ||
              this.stickerForIndex(index);
        usedStickerLabels.add(sticker.label);
        return {
          ...area,
          label: this.teamLabel(area.label, sticker),
          stickerIcon: sticker.icon,
          stickerLabel: sticker.label,
          stickerColor: sticker.color,
          stickerTint: sticker.tint,
          stickerStroke: sticker.stroke,
          bags: this.safeNumber(area.bags),
          volunteers: this.safeNumber(area.volunteers)
        };
      })
    };
  }

  private litterPickTitleFor(event: LitterPickEvent): string {
    if (!event.date) {
      return 'Community litter pick';
    }

    const date = new Date(`${event.date}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return 'Community litter pick';
    }

    const formatted = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(date);
    return `Community litter pick - ${formatted}`;
  }

  private createBoundaryPoints(): MapPoint[] {
    const minLat = Math.min(...HETHERSETT_BOUNDARY.map((point) => point.lat));
    const maxLat = Math.max(...HETHERSETT_BOUNDARY.map((point) => point.lat));
    const minLng = Math.min(...HETHERSETT_BOUNDARY.map((point) => point.lng));
    const maxLng = Math.max(...HETHERSETT_BOUNDARY.map((point) => point.lng));

    return HETHERSETT_BOUNDARY.map((point) => ({
      x: ((point.lng - minLng) / (maxLng - minLng)) * 100,
      y: ((maxLat - point.lat) / (maxLat - minLat)) * 100
    }));
  }

  private createCoverageSamplePoints(): MapPoint[] {
    const points: MapPoint[] = [];
    const steps = 64;
    for (let row = 0; row < steps; row += 1) {
      for (let col = 0; col < steps; col += 1) {
        const point = {
          x: ((col + 0.5) / steps) * 100,
          y: ((row + 0.5) / steps) * 100
        };
        if (this.isPointInsideBoundary(point)) {
          points.push(point);
        }
      }
    }
    return points;
  }

  private mapPointerToBoundaryPoint(event: PointerEvent): MapPoint | null {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const latLng = this.mapOffsetToLatLng(event.clientX - rect.left, event.clientY - rect.top);

    return this.latLngToBoundaryPoint(latLng);
  }

  private mapPointerToLatLng(event: PointerEvent): BoundaryCoordinate | null {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    return this.mapOffsetToLatLng(event.clientX - rect.left, event.clientY - rect.top);
  }

  private mapPointerToBoundaryPointFromViewport(event: PointerEvent): MapPoint | null {
    if (!this.litterPickMap?.nativeElement) {
      return null;
    }

    const rect = this.litterPickMap.nativeElement.getBoundingClientRect();
    const latLng = this.mapOffsetToLatLng(event.clientX - rect.left, event.clientY - rect.top);
    return this.latLngToBoundaryPoint(latLng);
  }

  private meetingPointCoordinate(event: LitterPickEvent | null): BoundaryCoordinate {
    return {
      lat: Number.isFinite(Number(event?.meetingPointLat)) ? Number(event?.meetingPointLat) : this.defaultMeetingPoint.lat,
      lng: Number.isFinite(Number(event?.meetingPointLng)) ? Number(event?.meetingPointLng) : this.defaultMeetingPoint.lng
    };
  }

  private beginAreaEditDrag(
    event: PointerEvent,
    areaId: string,
    kind: AreaEditDragState['kind'],
    pointIndex?: number
  ): void {
    if (
      !this.draftLitterPickEvent ||
      !this.isEditingLitterPick ||
      this.draftLitterPickEvent.status === 'closed' ||
      this.editingAreaId !== areaId
    ) {
      return;
    }

    const area = this.draftLitterPickEvent.areas.find((item) => item.id === areaId);
    const startPoint = this.mapPointerToBoundaryPointFromViewport(event);
    const originalPoints = area ? this.areaPoints(area) : [];
    if (!area || !startPoint || originalPoints.length < 3) {
      return;
    }

    this.activeAreaId = areaId;
    this.areaEditDrag = {
      pointerId: event.pointerId,
      areaId,
      kind,
      startPoint,
      originalPoints,
      pointIndex
    };
    this.litterPickMap?.nativeElement.setPointerCapture(event.pointerId);
  }

  private updateAreaEditDrag(event: PointerEvent): void {
    if (!this.areaEditDrag || this.areaEditDrag.pointerId !== event.pointerId) {
      return;
    }

    const currentPoint = this.mapPointerToBoundaryPointFromViewport(event);
    if (!currentPoint) {
      return;
    }

    if (this.areaEditDrag.kind === 'vertex') {
      this.updateAreaVertex(this.areaEditDrag, currentPoint);
      return;
    }

    this.updateAreaMove(this.areaEditDrag, currentPoint);
  }

  private finishAreaEditDrag(event: PointerEvent): void {
    if (!this.areaEditDrag || this.areaEditDrag.pointerId !== event.pointerId) {
      return;
    }

    if (this.litterPickMap?.nativeElement.hasPointerCapture(event.pointerId)) {
      this.litterPickMap.nativeElement.releasePointerCapture(event.pointerId);
    }
    this.areaEditDrag = undefined;
  }

  private updateAreaVertex(state: AreaEditDragState, point: MapPoint): void {
    if (state.pointIndex === undefined || !this.isPointInsideBoundary(point)) {
      return;
    }

    const nextPoints = state.originalPoints.map((current, index) =>
      index === state.pointIndex ? point : current
    );
    if (this.polygonArea(nextPoints) < 1 || !this.isPolygonInsideBoundary(nextPoints)) {
      return;
    }

    this.updateAreaPoints(state.areaId, nextPoints);
  }

  private updateAreaMove(state: AreaEditDragState, point: MapPoint): void {
    const delta = {
      x: point.x - state.startPoint.x,
      y: point.y - state.startPoint.y
    };
    const nextPoints = state.originalPoints.map((current) => ({
      x: current.x + delta.x,
      y: current.y + delta.y
    }));

    if (!this.isPolygonInsideBoundary(nextPoints)) {
      return;
    }

    this.updateAreaPoints(state.areaId, nextPoints);
  }

  private shouldPanLitterPickMap(event: PointerEvent): boolean {
    return (
      !this.draftLitterPickEvent ||
      !this.isEditingLitterPick ||
      this.draftLitterPickEvent.status === 'closed' ||
      this.litterPickMapMode === 'pan' ||
      event.shiftKey
    );
  }

  private isPointInsideBoundary(point: MapPoint): boolean {
    return this.isPointInPolygon(point, this.mapBoundaryPoints);
  }

  private isPolygonInsideBoundary(points: MapPoint[]): boolean {
    return points.every((point) => this.isPointInsideBoundary(point));
  }

  private isPointInsideArea(point: MapPoint, area: LitterPickArea): boolean {
    const points = this.areaPoints(area);
    if (points.length >= 3) {
      return this.isPointInPolygon(point, points);
    }

    const x = area.x ?? 0;
    const y = area.y ?? 0;
    const width = area.width ?? 0;
    const height = area.height ?? 0;

    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  }

  private isPointInPolygon(point: MapPoint, polygon: MapPoint[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const current = polygon[i];
      const previous = polygon[j];
      const intersects =
        current.y > point.y !== previous.y > point.y &&
        point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  private areaPoints(area: LitterPickArea): MapPoint[] {
    if (area.points && area.points.length >= 3) {
      return area.points.map((point) => ({ x: point.x, y: point.y }));
    }

    const x = area.x ?? 0;
    const y = area.y ?? 0;
    const width = area.width ?? 0;
    const height = area.height ?? 0;

    if (!width || !height) {
      return [];
    }

    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ];
  }

  private updateAreaPoints(areaId: string, points: MapPoint[]): void {
    if (!this.draftLitterPickEvent) {
      return;
    }

    const sanitizedPoints = this.sanitizeAreaPoints(points);
    const bounds = this.areaBounds(sanitizedPoints);
    this.draftLitterPickEvent.areas = this.draftLitterPickEvent.areas.map((area) =>
      area.id === areaId
        ? {
            ...area,
            points: sanitizedPoints,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        : area
    );
  }

  private sanitizeAreaPoints(points: MapPoint[]): MapPoint[] {
    return points.map((point) => ({
      x: Number(this.clamp(point.x, 0, 100).toFixed(2)),
      y: Number(this.clamp(point.y, 0, 100).toFixed(2))
    }));
  }

  private areaCentroid(area: LitterPickArea): MapPoint {
    const points = this.areaPoints(area);
    if (!points.length) {
      return { x: 50, y: 50 };
    }

    const total = points.reduce(
      (sum, point) => ({
        x: sum.x + point.x,
        y: sum.y + point.y
      }),
      { x: 0, y: 0 }
    );

    return {
      x: total.x / points.length,
      y: total.y / points.length
    };
  }

  private simplifyAreaPoints(points: MapPoint[]): MapPoint[] {
    const result: MapPoint[] = [];

    for (const point of points) {
      const clipped = {
        x: Number(this.clamp(point.x, 0, 100).toFixed(2)),
        y: Number(this.clamp(point.y, 0, 100).toFixed(2))
      };
      const previous = result[result.length - 1];
      if (!previous || this.distanceBetweenPoints(previous, clipped) >= 0.35) {
        result.push(clipped);
      }
    }

    return result;
  }

  private areaBounds(points: MapPoint[]): Pick<LitterPickArea, 'x' | 'y' | 'width' | 'height'> {
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));

    return {
      x: Number(minX.toFixed(2)),
      y: Number(minY.toFixed(2)),
      width: Number((maxX - minX).toFixed(2)),
      height: Number((maxY - minY).toFixed(2))
    };
  }

  private polygonArea(points: MapPoint[]): number {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
  }

  private distanceBetweenPoints(a: MapPoint, b: MapPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private boundaryPointToMapPosition(point: MapPoint): MapPoint {
    return this.latLngToMapPosition(this.boundaryPointToLatLng(point));
  }

  private latLngToMapPosition(point: BoundaryCoordinate): MapPoint {
    const center = this.latLngToPixel(this.litterPickCenterLat, this.litterPickCenterLng, this.litterPickZoom);
    const pixel = this.latLngToPixel(point.lat, point.lng, this.litterPickZoom);

    return {
      x: pixel.x - center.x + this.litterPickViewportWidth / 2,
      y: pixel.y - center.y + this.litterPickViewportHeight / 2
    };
  }

  private mapOffsetToLatLng(offsetX: number, offsetY: number): BoundaryCoordinate {
    const center = this.latLngToPixel(this.litterPickCenterLat, this.litterPickCenterLng, this.litterPickZoom);
    const worldX = center.x + (offsetX - this.litterPickViewportWidth / 2);
    const worldY = center.y + (offsetY - this.litterPickViewportHeight / 2);
    return this.pixelToLatLng(worldX, worldY, this.litterPickZoom);
  }

  private boundaryPointToLatLng(point: MapPoint): BoundaryCoordinate {
    const bounds = this.boundaryBounds();
    return {
      lat: bounds.maxLat - (point.y / 100) * (bounds.maxLat - bounds.minLat),
      lng: bounds.minLng + (point.x / 100) * (bounds.maxLng - bounds.minLng)
    };
  }

  private latLngToBoundaryPoint(point: BoundaryCoordinate): MapPoint {
    const bounds = this.boundaryBounds();
    return {
      x: this.clamp(((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100, 0, 100),
      y: this.clamp(((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * 100, 0, 100)
    };
  }

  private updateLitterPickViewportSize(): void {
    if (!this.litterPickMap?.nativeElement) {
      return;
    }

    const rect = this.litterPickMap.nativeElement.getBoundingClientRect();
    this.litterPickViewportWidth = rect.width;
    this.litterPickViewportHeight = rect.height;
  }

  private latLngToPixel(lat: number, lng: number, zoom: number): MapPoint {
    const sinLat = Math.sin((this.clamp(lat, -85.0511, 85.0511) * Math.PI) / 180);
    const scale = this.tileSize * 2 ** zoom;

    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
    };
  }

  private pixelToLatLng(x: number, y: number, zoom: number): BoundaryCoordinate {
    const scale = this.tileSize * 2 ** zoom;
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

    return { lat, lng };
  }

  private boundaryBounds(): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
    return {
      minLat: Math.min(...HETHERSETT_BOUNDARY.map((point) => point.lat)),
      maxLat: Math.max(...HETHERSETT_BOUNDARY.map((point) => point.lat)),
      minLng: Math.min(...HETHERSETT_BOUNDARY.map((point) => point.lng)),
      maxLng: Math.max(...HETHERSETT_BOUNDARY.map((point) => point.lng))
    };
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest('button, a, input, textarea, select'));
  }

  private scrollSelectedAreaIntoView(areaId: string): void {
    setTimeout(() => {
      const cards = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-litter-area-id]'));
      const card = cards.find((item) => item.dataset['litterAreaId'] === areaId);
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  private teamLabel(label: string, sticker: TeamSticker): string {
    return /^(Area|Team)\s+\d+$/i.test(label) || !label.trim() ? `Team ${sticker.label}` : label;
  }

  private findStickerForArea(area: LitterPickArea): TeamSticker | undefined {
    return this.teamStickers.find(
      (sticker) => sticker.label === area.stickerLabel || sticker.icon === area.stickerIcon
    );
  }

  private availableTeamStickers(event: Pick<LitterPickEvent, 'areas'>): TeamSticker[] {
    const usedLabels = new Set(
      event.areas
        .map((area) => this.findStickerForArea(area)?.label || area.stickerLabel)
        .filter((label): label is string => Boolean(label))
    );
    return this.teamStickers.filter((sticker) => !usedLabels.has(sticker.label));
  }

  private randomAvailableSticker(event: Pick<LitterPickEvent, 'areas'>): TeamSticker | null {
    const available = this.availableTeamStickers(event);
    if (!available.length) {
      return null;
    }

    return available[Math.floor(Math.random() * available.length)];
  }

  private randomStickerFrom(stickers: TeamSticker[]): TeamSticker | null {
    if (!stickers.length) {
      return null;
    }

    return stickers[Math.floor(Math.random() * stickers.length)];
  }

  private stickerForIndex(index: number): TeamSticker {
    return this.teamStickers[index % this.teamStickers.length];
  }

  private safeNumber(value: number | null | undefined): number {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private todayInputValue(): string {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${today.getFullYear()}-${month}-${day}`;
  }

  private timeInputValue(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private async createPhotoAttachment(file: File): Promise<PhotoAttachment> {
    const dataUrl = await this.readImageAsUploadDataUrl(file);
    return {
      fileName: file.name,
      contentType: this.dataUrlContentType(dataUrl) || file.type || 'image/jpeg',
      dataUrl
    };
  }

  private async readImageAsUploadDataUrl(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
      return this.readFileAsDataUrl(file);
    }

    try {
      return await this.compressImageFile(file);
    } catch {
      return this.readFileAsDataUrl(file);
    }
  }

  private compressImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        try {
          const sourceWidth = image.naturalWidth || image.width;
          const sourceHeight = image.naturalHeight || image.height;

          if (!sourceWidth || !sourceHeight) {
            reject(new Error('Image has no dimensions.'));
            return;
          }

          const scale = Math.min(1, this.uploadPhotoMaxEdge / Math.max(sourceWidth, sourceHeight));
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');

          if (!context) {
            reject(new Error('Unable to prepare image.'));
            return;
          }

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', this.uploadPhotoQuality));
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Unable to load image.'));
      };

      image.src = objectUrl;
    });
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
