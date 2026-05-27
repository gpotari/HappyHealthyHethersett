import { AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, Subscription } from 'rxjs';
import { EventItem } from '../models/event-item';
import { FeedbackMessage } from '../models/feedback-message';
import { LitterPickArea, LitterPickCoverageItem, LitterPickEvent } from '../models/litter-pick-event';
import { LitterReport, LitterReportState } from '../models/litter-report';
import { PhotoAttachment } from '../models/photo-attachment';
import { CurrentUser, ManagedUser } from '../models/user';
import {
  BoundaryCoordinate,
  HETHERSETT_BOUNDARY,
  HETHERSETT_MAP_BOUNDS,
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
type UserRole = 'Admin' | 'Editor' | 'User';
type ReportStateFilter = LitterReportState | 'all';
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
type AreaEditControlMode = 'polygon' | 'street';
type MeetingPointTarget = 'new' | 'draft';

type StreetSearchResult = {
  lat: string;
  lon: string;
  category?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  display_name?: string;
  boundingbox?: string[];
  importance?: number | string;
  place_rank?: number | string;
  osm_type?: string;
  osm_id?: number | string;
  geojson?: StreetGeoJson;
};

type StreetGeoJson = {
  type?: string;
  coordinates?: unknown;
  geometries?: StreetGeoJson[];
};

type AreaEditDragState = {
  pointerId: number;
  areaId: string;
  polygonIndex: number;
  controlMode: AreaEditControlMode;
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
  readonly reportStates: LitterReportState[] = ['new', 'addressed'];
  reportStateFilter: ReportStateFilter = 'all';
  selectedReportId: string | null = null;
  openReportStatePickerId: string | null = null;
  reportStateSaving: Record<string, boolean> = {};
  reportDeleting: Record<string, boolean> = {};
  activeReportPhoto: PhotoAttachment | null = null;
  litterPickEvents: LitterPickEvent[] = [];
  users: ManagedUser[] = [];
  usersLoading = false;
  usersSaving = false;
  usersError = '';
  resetPasswords: Record<string, string> = {};
  pendingUserRoles: Record<string, UserRole> = {};
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
  litterPickStreetSearch = '';
  litterPickStreetSearchLoading = false;
  litterPickStreetSearchMessage = '';
  areaStreetLookupMessages: Record<string, string> = {};
  areaStreetLookupBusy: Record<string, boolean> = {};
  areaStreetLookupFields: Record<string, string> = {};
  newAreaStreetInputs: Record<string, string> = {};
  areaStreetPreviewPolygons: Record<string, MapPoint[][]> = {};
  areaStreetSectionsExpanded: Record<string, boolean> = {};
  litterPickViewportWidth = 760;
  litterPickViewportHeight = 420;
  litterPickMapMode: LitterPickMapMode = 'pan';
  litterPickWorkspaceFullscreen = false;
  editingAreaId: string | null = null;
  editingAreaPolygonIndex: number | null = null;
  editingAreaControlMode: AreaEditControlMode = 'polygon';
  editingAreaStreetIndex: number | null = null;
  drawingAreaId: string | null = null;
  drawingCoverageItemIndex: number | null = null;
  meetingPointTarget: MeetingPointTarget | null = null;
  private dragStart: MapPoint | null = null;
  private areaEditDrag?: AreaEditDragState;
  panState?: {
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: MapPoint;
  };
  private pendingPanPosition?: { clientX: number; clientY: number };
  private panAnimationFrame: number | null = null;
  private resizeObserver?: ResizeObserver;
  private observedLitterPickMap?: HTMLElement;
  private authSubscription?: Subscription;
  private areaStreetLookupTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private areaStreetLookupTokens: Record<string, number> = {};
  private areaStreetLookupOperations: Record<string, string> = {};
  private areaStreetPreviewTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private areaStreetPreviewTokens: Record<string, number> = {};
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
        this.isUnlocked = this.hasAdminPanelAccess(user);
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
    if (this.panAnimationFrame !== null) {
      cancelAnimationFrame(this.panAnimationFrame);
    }
    Object.values(this.areaStreetLookupTimers).forEach((timer) => clearTimeout(timer));
    Object.values(this.areaStreetPreviewTimers).forEach((timer) => clearTimeout(timer));
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
        this.registerMessage = 'Registration complete. You can now sign in.';
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
    if (!this.canDeleteContent) {
      this.errorMessage = 'Editors can create and edit events, but only admins can delete them.';
      return;
    }

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
    this.saveLitterPickEvents(updated, 'Litter pick event created. Use + Team to add a team, then draw coverage or list streets.', (events) => {
      this.newLitterPickEvent = this.emptyLitterPickEvent();
      this.litterPickCreateAttempted = false;
      this.showLitterPickCreateForm = false;
      this.openLitterPickDraft(events.findIndex((item) => item.id === event.id), true);
    });
  }

  deleteLitterPickEvent(index: number): void {
    if (!this.canDeleteContent) {
      this.errorMessage = 'Editors can create and edit litter pick events, but only admins can delete them.';
      return;
    }

    const event = this.litterPickEvents[index];
    if (!event) {
      return;
    }

    const confirmed = window.confirm(`Delete ${this.formatLitterPickDate(event)}? This permanently removes the litter pick event.`);
    if (!confirmed) {
      return;
    }

    this.statusMessage = '';
    const updated = this.litterPickEvents.filter((_, i) => i !== index);
    this.saveLitterPickEvents(updated, 'Litter pick event deleted and saved.', () => {
      this.expandedLitterPickIndex = null;
      this.isEditingLitterPick = false;
      this.draftLitterPickEvent = null;
      this.activeAreaId = null;
    });
  }

  deleteCurrentLitterPickEvent(): void {
    if (this.expandedLitterPickIndex === null) {
      return;
    }

    this.deleteLitterPickEvent(this.expandedLitterPickIndex);
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
    if (!this.canDeleteContent) {
      this.errorMessage = 'Only admins can upload event JSON because it can remove events.';
      input.value = '';
      return;
    }

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

  openLitterPickDetails(index: number): void {
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
    this.editingAreaPolygonIndex = null;
    this.editingAreaControlMode = 'polygon';
    this.editingAreaStreetIndex = null;
    this.drawingAreaId = null;
    this.drawingCoverageItemIndex = null;
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
    this.editingAreaPolygonIndex = null;
    this.editingAreaControlMode = 'polygon';
    this.editingAreaStreetIndex = null;
    this.drawingAreaId = null;
    this.drawingCoverageItemIndex = null;
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
      this.editingAreaPolygonIndex = null;
      this.editingAreaControlMode = 'polygon';
      this.editingAreaStreetIndex = null;
      this.drawingAreaId = null;
      this.drawingCoverageItemIndex = null;
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
    if (!this.canOpenSection(section)) {
      section = 'events';
    }

    this.activeAdminSection = section;
    this.statusMessage = '';
    this.errorMessage = '';
    this.closeReportPhoto();
    this.closeReportDetails();

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

  get canManageSubmissions(): boolean {
    return this.currentUser?.roles.includes('Admin') ?? false;
  }

  get canDeleteContent(): boolean {
    return this.currentUser?.roles.includes('Admin') ?? false;
  }

  get adminIntro(): string {
    return this.canManageSubmissions
      ? 'Manage public events, feedback and litter reports from one simple workspace.'
      : 'Manage public events and litter pick events from one simple workspace.';
  }

  get isSignedInWithoutAdminAccess(): boolean {
    return Boolean(this.currentUser && !this.isUnlocked);
  }

  private handleAuthenticatedUser(user: CurrentUser | null): void {
    const previousUserId = this.currentUser?.id || null;
    const wasUnlocked = this.isUnlocked;
    const wasAdmin = this.currentUser?.roles.includes('Admin') ?? false;
    this.currentUser = user;
    this.isUnlocked = this.hasAdminPanelAccess(user);

    if (this.isUnlocked) {
      this.ensureOpenSectionIsAllowed();
      this.clearRestrictedWorkspaceForEditors();
      if (!this.adminWorkspaceLoaded || !wasUnlocked || previousUserId !== user?.id || (!wasAdmin && this.canManageUsers)) {
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
    this.loadLitterPickEvents();

    if (this.canManageSubmissions) {
      this.loadReports();
      this.loadFeedbackMessages();
    }

    if (this.canManageUsers) {
      this.loadUsers();
    }
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

  private hasAdminPanelAccess(user: CurrentUser | null): boolean {
    return user?.roles.some((role) => role === 'Admin' || role === 'Editor') ?? false;
  }

  private canOpenSection(section: AdminSection): boolean {
    return section === 'events' || section === 'litterPicks' || this.canManageSubmissions;
  }

  private ensureOpenSectionIsAllowed(): void {
    if (!this.canOpenSection(this.activeAdminSection)) {
      this.activeAdminSection = 'events';
    }
  }

  private clearRestrictedWorkspaceForEditors(): void {
    if (this.canManageSubmissions) {
      return;
    }

    this.feedbackMessages = [];
    this.reports = [];
    this.users = [];
    this.resetPasswords = {};
    this.pendingUserRoles = {};
    this.pendingUserDisabled = {};
    this.showUserCreateForm = false;
    this.closeReportDetails();
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
          this.pendingUserRoles[user.id] = this.userRole(user);
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
    if (!this.isUserRole(role)) {
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

  deleteUser(user: ManagedUser): void {
    if (this.currentUser?.id === user.id) {
      this.usersError = 'You cannot delete your own account.';
      return;
    }

    const label = user.displayName ? `${user.displayName} (${user.email})` : user.email;
    const confirmed = window.confirm(`Delete ${label}? This permanently removes the account and cannot be undone.`);
    if (!confirmed) {
      return;
    }

    this.usersError = '';
    this.statusMessage = '';
    this.authService.deleteUser(user.id).subscribe({
      next: () => {
        this.users = this.users.filter((item) => item.id !== user.id);
        delete this.pendingUserRoles[user.id];
        delete this.pendingUserDisabled[user.id];
        delete this.resetPasswords[user.id];
        this.statusMessage = `Deleted ${user.email}.`;
      },
      error: () => {
        this.usersError = 'Unable to delete user.';
      }
    });
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

  userRole(user: ManagedUser): UserRole {
    if (user.roles.includes('Admin')) {
      return 'Admin';
    }

    return user.roles.includes('Editor') ? 'Editor' : 'User';
  }

  selectedUserRole(user: ManagedUser): UserRole {
    return this.pendingUserRoles[user.id] ?? this.userRole(user);
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

  creatorName(event: EventItem | LitterPickEvent): string {
    return event.createdBy?.displayName?.trim() || 'Happy Healthy Hethersett';
  }

  creatorAvatar(event: EventItem | LitterPickEvent): string {
    return event.createdBy?.avatarDataUrl || '';
  }

  creatorInitials(event: EventItem | LitterPickEvent): string {
    const parts = this.creatorName(event)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join('') || 'HH').toUpperCase();
  }

  updaterName(event: EventItem | LitterPickEvent): string {
    return event.updatedBy?.displayName?.trim() || 'Happy Healthy Hethersett';
  }

  updaterAvatar(event: EventItem | LitterPickEvent): string {
    return event.updatedBy?.avatarDataUrl || '';
  }

  updaterInitials(event: EventItem | LitterPickEvent): string {
    const parts = this.updaterName(event)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join('') || 'HH').toUpperCase();
  }

  createdDate(event: EventItem | LitterPickEvent): string {
    if (!event.createdAt) {
      return 'Created date not saved yet';
    }

    const createdAt = new Date(event.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return 'Created date not saved yet';
    }

    return this.formatDateTime(event.createdAt);
  }

  updatedDate(event: EventItem | LitterPickEvent): string {
    if (!event.updatedAt) {
      return 'Updated date not saved yet';
    }

    const updatedAt = new Date(event.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) {
      return 'Updated date not saved yet';
    }

    return this.formatDateTime(event.updatedAt);
  }

  creatorMeta(event: EventItem | LitterPickEvent): string {
    return `Created by ${this.creatorName(event)} · ${this.createdDate(event)}`;
  }

  updaterMeta(event: EventItem | LitterPickEvent): string {
    return `Updated by ${this.updaterName(event)} · ${this.updatedDate(event)}`;
  }

  creatorHistoryLabel(event: EventItem | LitterPickEvent): string {
    if (this.showUpdatedMeta(event) && !this.showUpdaterAvatar(event)) {
      return `Created and edited by ${this.creatorName(event)}. Edited on ${this.updatedDate(event)}`;
    }

    return `Created by ${this.creatorName(event)} on ${this.createdDate(event)}`;
  }

  updaterHistoryLabel(event: EventItem | LitterPickEvent): string {
    return `Edited by ${this.updaterName(event)} on ${this.updatedDate(event)}`;
  }

  showUpdatedMeta(event: EventItem | LitterPickEvent): boolean {
    if (!event.updatedAt && !event.updatedBy) {
      return false;
    }

    return !this.sameMeta(event.createdAt, event.updatedAt, event.createdBy?.id, event.updatedBy?.id);
  }

  showUpdaterAvatar(event: EventItem | LitterPickEvent): boolean {
    if (!this.showUpdatedMeta(event)) {
      return false;
    }

    if (event.createdBy?.id && event.updatedBy?.id) {
      return event.createdBy.id !== event.updatedBy.id;
    }

    return this.creatorName(event) !== this.updaterName(event);
  }

  private formatDateTime(value: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private sameMeta(createdAt?: string, updatedAt?: string, createdById?: string, updatedById?: string): boolean {
    const createdTime = createdAt ? new Date(createdAt).getTime() : Number.NaN;
    const updatedTime = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
    const sameTime = Number.isFinite(createdTime) && Number.isFinite(updatedTime) && Math.abs(createdTime - updatedTime) < 1000;
    const sameUser = (createdById || '') === (updatedById || '');
    return sameTime && sameUser;
  }

  refreshReports(): void {
    this.loadReports();
  }

  get filteredReports(): LitterReport[] {
    return this.reports.filter((report) => this.reportMatchesFilter(report));
  }

  get selectedReport(): LitterReport | null {
    if (!this.selectedReportId) {
      return null;
    }

    return this.reports.find((report) => report.id === this.selectedReportId) ?? null;
  }

  setReportFilter(filter: ReportStateFilter): void {
    this.reportStateFilter = filter;
    this.closeReportStatePicker();
    if (this.selectedReport && !this.reportMatchesFilter(this.selectedReport)) {
      this.selectedReportId = null;
    }
  }

  selectReport(report: LitterReport): void {
    this.selectedReportId = report.id ?? null;
  }

  closeReportDetails(): void {
    this.selectedReportId = null;
    this.closeReportPhoto();
    this.closeReportStatePicker();
  }

  @HostListener('document:click')
  closeReportStatePicker(): void {
    this.openReportStatePickerId = null;
  }

  toggleReportStatePicker(report: LitterReport, event?: Event): void {
    event?.stopPropagation();
    if (!report.id || this.isReportStateSaving(report) || this.isReportDeleting(report)) {
      return;
    }

    const pickerId = this.reportStatePickerId(report);
    this.openReportStatePickerId = this.openReportStatePickerId === pickerId ? null : pickerId;
  }

  isReportStatePickerOpen(report: LitterReport): boolean {
    return this.openReportStatePickerId === this.reportStatePickerId(report);
  }

  chooseReportState(report: LitterReport, state: string, event?: Event): void {
    event?.stopPropagation();
    this.closeReportStatePicker();
    this.setReportState(report, state);
  }

  setReportState(report: LitterReport, state: string): void {
    const id = report.id;
    const nextState = this.normalizeReportState(state);
    if (!id || this.reportState(report) === nextState) {
      return;
    }

    this.statusMessage = '';
    this.reportsError = '';
    this.reportStateSaving[id] = true;
    this.litterReportsService.updateReportState(id, nextState).subscribe({
      next: (updatedReport) => {
        this.reportStateSaving[id] = false;
        this.reports = this.sortReports(this.reports.map((item) => (item.id === updatedReport.id ? updatedReport : item)));
        if (this.selectedReportId === updatedReport.id && !this.reportMatchesFilter(updatedReport)) {
          this.selectedReportId = null;
        }
        this.statusMessage = `Litter report marked ${this.reportStateLabel(updatedReport.state).toLowerCase()}.`;
      },
      error: () => {
        this.reportStateSaving[id] = false;
        this.reportsError = 'Unable to update that litter report.';
      }
    });
  }

  deleteReport(report: LitterReport): void {
    const id = report.id;
    if (!id) {
      return;
    }

    const confirmed = window.confirm(`Delete ${report.amount || 'this litter report'} from ${this.formatReportDate(report)}? This permanently removes the report and photos.`);
    if (!confirmed) {
      return;
    }

    this.statusMessage = '';
    this.reportsError = '';
    this.reportDeleting[id] = true;
    this.litterReportsService.deleteReport(id).subscribe({
      next: () => {
        delete this.reportDeleting[id];
        delete this.reportStateSaving[id];
        this.reports = this.reports.filter((item) => item.id !== id);
        this.closeReportPhoto();
        if (this.selectedReportId === id) {
          this.selectedReportId = null;
        }
        this.statusMessage = 'Litter report deleted.';
      },
      error: () => {
        this.reportDeleting[id] = false;
        this.reportsError = 'Unable to delete that litter report.';
      }
    });
  }

  reportState(report: LitterReport): LitterReportState {
    return this.normalizeReportState(report.state);
  }

  reportStateLabel(state?: string): string {
    return this.normalizeReportState(state) === 'addressed' ? 'Addressed' : 'Open';
  }

  reportStatePickerId(report: LitterReport): string {
    return report.id ? `report-state-${report.id}` : '';
  }

  reportAmountLevel(report: LitterReport): 'small' | 'medium' | 'large' | 'unknown' {
    const amount = (report.amount || '').toLowerCase();
    if (amount.includes('large')) {
      return 'large';
    }

    if (amount.includes('medium')) {
      return 'medium';
    }

    if (amount.includes('small')) {
      return 'small';
    }

    return 'unknown';
  }

  reportAmountLabel(report: LitterReport): string {
    return report.amount || 'Amount not specified';
  }

  reportCount(state: LitterReportState): number {
    return this.reports.filter((report) => this.reportState(report) === state).length;
  }

  isReportStateSaving(report: LitterReport): boolean {
    return Boolean(report.id && this.reportStateSaving[report.id]);
  }

  isReportDeleting(report: LitterReport): boolean {
    return Boolean(report.id && this.reportDeleting[report.id]);
  }

  openReportPhoto(photo: PhotoAttachment): void {
    this.activeReportPhoto = photo;
  }

  closeReportPhoto(): void {
    this.activeReportPhoto = null;
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

  private sortReports(reports: LitterReport[]): LitterReport[] {
    return [...reports].sort((a, b) => {
      const stateComparison = this.reportStateRank(a) - this.reportStateRank(b);
      if (stateComparison !== 0) {
        return stateComparison;
      }

      return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    });
  }

  private reportStateRank(report: LitterReport): number {
    return this.reportState(report) === 'addressed' ? 1 : 0;
  }

  private reportMatchesFilter(report: LitterReport): boolean {
    return this.reportStateFilter === 'all' || this.reportState(report) === this.reportStateFilter;
  }

  private normalizeReportState(state?: string): LitterReportState {
    return state === 'addressed' ? 'addressed' : 'new';
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

  async searchLitterPickStreet(): Promise<void> {
    const query = this.litterPickStreetSearch.trim();
    if (!query || this.litterPickStreetSearchLoading) {
      return;
    }

    this.litterPickStreetSearchLoading = true;
    this.litterPickStreetSearchMessage = '';

    try {
      const result = await this.findHethersettStreet(query);
      if (!result) {
        this.litterPickStreetSearchMessage = 'No matching Hethersett street found.';
        return;
      }

      const lat = Number(result.lat);
      const lng = Number(result.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Street search returned invalid coordinates.');
      }

      this.focusStreetSearchResult(result);
      this.litterPickStreetSearchMessage = `Centred on ${this.streetSearchLabel(result, query)}.`;
    } catch {
      this.litterPickStreetSearchMessage = 'Street search is unavailable right now.';
    } finally {
      this.litterPickStreetSearchLoading = false;
    }
  }

  setLitterPickMapMode(mode: LitterPickMapMode): void {
    this.litterPickMapMode = mode;
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.cancelPendingPanAnimation();
    this.pendingPanPosition = undefined;
    this.panState = undefined;
    this.areaEditDrag = undefined;
    this.drawingAreaId = mode === 'draw' ? this.drawingAreaId : null;
    this.drawingCoverageItemIndex = mode === 'draw' ? this.drawingCoverageItemIndex : null;
    if (mode !== 'edit') {
      this.editingAreaId = null;
      this.editingAreaPolygonIndex = null;
      this.editingAreaControlMode = 'polygon';
      this.editingAreaStreetIndex = null;
    }
    if (mode !== 'meeting') {
      this.meetingPointTarget = null;
    }
  }

  startNewTeamArea(): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    const sticker = this.randomAvailableSticker(this.draftLitterPickEvent);
    if (!sticker) {
      return;
    }

    if (!this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    const newArea: LitterPickArea = {
      id: this.createId('area'),
      label: `Team ${sticker.label}`,
      stickerIcon: sticker.icon,
      stickerLabel: sticker.label,
      stickerColor: sticker.color,
      stickerTint: sticker.tint,
      stickerStroke: sticker.stroke,
      bags: 0,
      volunteers: 0,
      coverageItems: [],
      streetNames: [],
      streets: '',
      notes: ''
    };
    this.draftLitterPickEvent.areas = [...this.draftLitterPickEvent.areas, newArea];
    this.activeAreaId = newArea.id;
    this.areaStreetSectionsExpanded[newArea.id] = true;
    this.setLitterPickMapMode('pan');
    this.scrollSelectedAreaIntoView(newArea.id);
  }

  startTeamAreaDraw(areaId: string): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    const area = this.draftLitterPickEvent.areas.find((item) => item.id === areaId);
    if (!area) {
      return;
    }

    if (!this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    this.activeAreaId = areaId;
    this.drawingAreaId = areaId;
    this.drawingCoverageItemIndex = null;
    this.editingAreaId = null;
    this.editingAreaPolygonIndex = null;
    this.editingAreaControlMode = 'polygon';
    this.editingAreaStreetIndex = null;
    this.litterPickMapMode = 'draw';
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
    this.scrollSelectedAreaIntoView(areaId);
  }

  startCoverageItemDraw(areaId: string, itemIndex: number): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    const area = this.draftLitterPickEvent.areas.find((item) => item.id === areaId);
    const items = area ? this.normalizedAreaCoverageItems(area) : [];
    if (!area || !items[itemIndex]) {
      return;
    }

    if (!this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    this.activeAreaId = areaId;
    this.drawingAreaId = areaId;
    this.drawingCoverageItemIndex = itemIndex;
    this.editingAreaId = null;
    this.editingAreaPolygonIndex = null;
    this.editingAreaControlMode = 'polygon';
    this.editingAreaStreetIndex = null;
    this.litterPickMapMode = 'draw';
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
    this.areaStreetSectionsExpanded[areaId] = true;
    this.areaStreetLookupMessages[areaId] = 'Draw the coverage polygon for this item.';
    this.scrollSelectedAreaIntoView(areaId);
  }

  onAreaStreetsChange(area: LitterPickArea): void {
    const items = this.parseStreetNames(area.streets || '').map((streetName) =>
      this.createStreetCoverageItem(streetName)
    );
    this.areaStreetSectionsExpanded[area.id] = true;
    this.replaceAreaCoverageItems(area.id, items);
  }

  areaCoverageRows(area: LitterPickArea): LitterPickCoverageItem[] {
    return this.normalizedAreaCoverageItems(area);
  }

  areaStreetDisplay(area: LitterPickArea): string {
    return this.normalizedAreaCoverageItems(area)
      .map((item, index) => this.coverageItemDisplay(item, index))
      .filter(Boolean)
      .join(', ');
  }

  areaCoverageCountLabel(area: LitterPickArea): string {
    const count = this.areaCoverageRows(area).length;
    return count ? `${count} item${count === 1 ? '' : 's'}` : 'None';
  }

  areaStreetSummary(area: LitterPickArea): string {
    const items = this.areaCoverageRows(area);
    if (!items.length) {
      return 'No streets added yet.';
    }

    const labels = items.map((item, index) => this.coverageItemDisplay(item, index)).filter(Boolean);
    const visibleLabels = labels.slice(0, 3).join(', ');
    const remaining = Math.max(labels.length - 3, 0);
    return remaining ? `${visibleLabels} + ${remaining} more` : visibleLabels || this.areaCoverageCountLabel(area);
  }

  isAreaStreetsExpanded(area: LitterPickArea): boolean {
    const stored = this.areaStreetSectionsExpanded[area.id];
    if (stored !== undefined) {
      return stored;
    }

    return this.areaCoverageRows(area).length === 0;
  }

  toggleAreaStreets(areaId: string): void {
    const area = this.draftLitterPickEvent?.areas.find((item) => item.id === areaId);
    if (!area) {
      return;
    }

    this.areaStreetSectionsExpanded[areaId] = !this.isAreaStreetsExpanded(area);
  }

  coverageItemCanFocus(item: LitterPickCoverageItem): boolean {
    return Boolean(item.polygon?.length || item.streetName?.trim());
  }

  coverageItemDisplay(item: LitterPickCoverageItem, index: number): string {
    if (item.kind === 'drawn') {
      return item.label?.trim() || `Drawn area ${index + 1}`;
    }

    return item.streetName?.trim() || item.label?.trim() || '';
  }

  setAreaCoverageItemKind(area: LitterPickArea, index: number, kind: 'street' | 'drawn'): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const items = this.normalizedAreaCoverageItems(area).map((item) => ({ ...item }));
    const item = items[index];
    if (!item || item.kind === kind) {
      return;
    }

    const display = this.coverageItemDisplay(item, index);
    items[index] = {
      ...item,
      kind,
      label: kind === 'drawn' ? display || `Drawn area ${index + 1}` : item.label,
      streetName: kind === 'street' ? item.streetName || display : undefined
    };
    this.clearAreaStreetPreview(area.id);
    this.replaceAreaCoverageItems(area.id, items);
  }

  setAreaCoverageItemStreetName(area: LitterPickArea, index: number, value: string): void {
    const items = this.normalizedAreaCoverageItems(area);
    const item = items[index];
    if (!item || item.kind !== 'street') {
      return;
    }

    item.streetName = value;
    item.label = value;
    area.coverageItems = items;
    area.streetNames = this.coverageItemStreetNames(items);
    area.streets = area.streetNames.join(', ');
    this.scheduleAreaStreetPreview(area.id, value, `street-${index}`);
  }

  setAreaCoverageItemLabel(area: LitterPickArea, index: number, value: string): void {
    const items = this.normalizedAreaCoverageItems(area);
    const item = items[index];
    if (!item || item.kind !== 'drawn') {
      return;
    }

    item.label = value;
    area.coverageItems = items;
  }

  setNewAreaStreetInput(area: LitterPickArea, value: string): void {
    this.newAreaStreetInputs[area.id] = value;
    this.scheduleAreaStreetPreview(area.id, value, 'new');
  }

  addAreaStreet(area: LitterPickArea): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const streetNames = this.parseStreetNames(this.newAreaStreetInputs[area.id] || '');
    if (!streetNames.length) {
      return;
    }

    const items = [
      ...this.normalizedAreaCoverageItems(area),
      ...streetNames.map((streetName) => this.createStreetCoverageItem(streetName))
    ];
    this.areaStreetSectionsExpanded[area.id] = true;
    this.replaceAreaCoverageItems(area.id, items);
    void this.mapAreaFromStreets(area.id, 'new');
    this.newAreaStreetInputs[area.id] = '';
    this.clearAreaStreetPreview(area.id);
  }

  addAreaDrawnCoverageItem(area: LitterPickArea): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const items = [
      ...this.normalizedAreaCoverageItems(area),
      this.createDrawnCoverageItem(`Drawn area ${this.normalizedAreaCoverageItems(area).length + 1}`)
    ];
    this.areaStreetSectionsExpanded[area.id] = true;
    this.replaceAreaCoverageItems(area.id, items);
    this.startCoverageItemDraw(area.id, items.length - 1);
  }

  updateAreaCoverageItemStreet(area: LitterPickArea, index: number): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    void this.mapAreaFromStreets(area.id, `street-${index}`);
  }

  toggleAreaCoverageItemEdit(area: LitterPickArea, index: number): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const polygonIndex = this.coverageItemPolygonIndex(area, index);
    if (polygonIndex < 0) {
      this.areaStreetLookupMessages[area.id] = 'Add coverage first, then edit the shape.';
      return;
    }

    this.toggleAreaEdit(area.id, polygonIndex, 'street', index);
  }

  drawAreaCoverageItem(area: LitterPickArea, index: number): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    this.startCoverageItemDraw(area.id, index);
  }

  async focusAreaCoverageItem(area: LitterPickArea, index: number): Promise<void> {
    const items = this.normalizedAreaCoverageItems(area);
    const item = items[index];
    if (!item) {
      return;
    }

    this.activeAreaId = area.id;
    if (item.polygon?.length) {
      this.focusMapPoints(item.polygon);
      this.areaStreetLookupMessages[area.id] = `Focused ${this.coverageItemDisplay(item, index)}.`;
      return;
    }

    const streetName = item.streetName?.trim();
    if (!streetName) {
      return;
    }

    const token = (this.areaStreetLookupTokens[area.id] || 0) + 1;
    this.areaStreetLookupTokens[area.id] = token;
    const operationId = `focus-${token}`;
    this.setAreaStreetLookupBusy(area.id, `street-${index}`, operationId);
    this.areaStreetLookupMessages[area.id] = 'Finding street...';

    try {
      const result = await this.findHethersettStreet(streetName);
      if (this.areaStreetLookupTokens[area.id] !== token) {
        return;
      }

      if (!result) {
        this.areaStreetLookupMessages[area.id] = 'No matching Hethersett street found.';
        return;
      }

      const polygons = this.streetSearchResultCoveragePolygons(result);
      if (polygons.length) {
        this.areaStreetPreviewPolygons[area.id] = polygons;
        this.focusMapPoints(polygons[0]);
      } else {
        this.focusStreetSearchResult(result);
      }
      this.areaStreetLookupMessages[area.id] = `Focused ${this.streetSearchLabel(result, streetName)}.`;
    } catch {
      if (this.areaStreetLookupTokens[area.id] === token) {
        this.areaStreetLookupMessages[area.id] = 'Street focus is unavailable right now.';
      }
    } finally {
      this.clearAreaStreetLookupBusy(area.id, operationId);
    }
  }

  removeAreaCoverageItem(area: LitterPickArea, index: number): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const items = [...this.normalizedAreaCoverageItems(area)];
    if (index < 0 || index >= items.length) {
      return;
    }

    if (this.editingAreaId === area.id && this.editingAreaControlMode === 'street') {
      this.setLitterPickMapMode('pan');
    }
    items.splice(index, 1);
    this.clearAreaStreetPreview(area.id);
    if (!items.length) {
      this.areaStreetSectionsExpanded[area.id] = true;
    }
    this.replaceAreaCoverageItems(area.id, items);
  }

  trackByCoverageItem(index: number, item: LitterPickCoverageItem): string {
    return item.id || String(index);
  }

  trackByArea(_index: number, area: LitterPickArea): string {
    return area.id;
  }

  trackByMapTile(_index: number, tile: MapTile): string {
    return tile.key;
  }

  trackByIndex(index: number): number {
    return index;
  }

  isEditingAreaPolygon(areaId: string, polygonIndex: number): boolean {
    return this.editingAreaId === areaId && this.editingAreaPolygonIndex === polygonIndex && this.litterPickMapMode === 'edit';
  }

  isEditingAreaStreetCoverage(area: LitterPickArea, streetIndex: number): boolean {
    return (
      this.editingAreaId === area.id &&
      this.editingAreaControlMode === 'street' &&
      this.editingAreaStreetIndex === streetIndex &&
      this.litterPickMapMode === 'edit'
    );
  }

  isDrawingAreaCoverageItem(area: LitterPickArea, itemIndex: number): boolean {
    return this.drawingAreaId === area.id && this.drawingCoverageItemIndex === itemIndex && this.litterPickMapMode === 'draw';
  }

  streetPreviewPolygonsFor(area: LitterPickArea): MapPoint[][] {
    return this.areaStreetPreviewPolygons[area.id] || [];
  }

  isAreaStreetLookupBusy(areaId: string, fieldKey: string): boolean {
    return Boolean(this.areaStreetLookupBusy[areaId] && this.areaStreetLookupFields[areaId] === fieldKey);
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
    this.editingAreaPolygonIndex = null;
    this.editingAreaControlMode = 'polygon';
    this.editingAreaStreetIndex = null;
    this.drawingAreaId = null;
    this.drawingCoverageItemIndex = null;
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

    if (this.drawingAreaId) {
      const areaId = this.drawingAreaId;
      if (this.drawingCoverageItemIndex !== null) {
        this.updateCoverageItemPolygon(areaId, this.drawingCoverageItemIndex, points);
        this.areaStreetLookupMessages[areaId] = 'Drawn coverage set for this item.';
      } else {
        this.updateAreaPoints(areaId, points);
        this.areaStreetLookupMessages[areaId] = 'Drawn coverage set for this team.';
      }
      this.activeAreaId = areaId;
      this.drawingAreaId = null;
      this.drawingCoverageItemIndex = null;
      this.litterPickMapMode = 'pan';
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
      coverageItems: [],
      streetNames: [],
      streets: '',
      notes: ''
    };
    this.draftLitterPickEvent.areas = [...this.draftLitterPickEvent.areas, newArea];
    this.activeAreaId = newArea.id;
    this.setLitterPickMapMode('pan');
  }

  beginLitterPickMapPan(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    this.cancelPendingPanAnimation();
    event.currentTarget.setPointerCapture(event.pointerId);
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.pendingPanPosition = undefined;
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

    this.pendingPanPosition = { clientX: event.clientX, clientY: event.clientY };
    if (this.panAnimationFrame !== null) {
      return;
    }

    this.panAnimationFrame = requestAnimationFrame(() => {
      this.panAnimationFrame = null;
      const position = this.pendingPanPosition;
      this.pendingPanPosition = undefined;
      if (position) {
        this.applyLitterPickMapPan(position.clientX, position.clientY);
      }
    });
  }

  private applyLitterPickMapPan(clientX: number, clientY: number): void {
    if (!this.panState) {
      return;
    }

    const dx = clientX - this.panState.startX;
    const dy = clientY - this.panState.startY;
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

    this.cancelPendingPanAnimation();
    const position = this.pendingPanPosition;
    this.pendingPanPosition = undefined;
    if (position) {
      this.applyLitterPickMapPan(position.clientX, position.clientY);
    }

    const map = event.currentTarget as HTMLElement;
    if (map.hasPointerCapture(event.pointerId)) {
      map.releasePointerCapture(event.pointerId);
    }
    this.panState = undefined;
  }

  private cancelPendingPanAnimation(): void {
    if (this.panAnimationFrame !== null) {
      cancelAnimationFrame(this.panAnimationFrame);
      this.panAnimationFrame = null;
    }
  }

  cancelAreaDraw(): void {
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.drawingAreaId = null;
    this.drawingCoverageItemIndex = null;
    this.cancelPendingPanAnimation();
    this.pendingPanPosition = undefined;
    this.panState = undefined;
    this.areaEditDrag = undefined;
    if (this.litterPickMapMode === 'draw') {
      this.litterPickMapMode = 'pan';
    }
  }

  selectArea(areaId: string): void {
    this.activeAreaId = areaId;
    this.scrollSelectedAreaIntoView(areaId);
  }

  toggleAreaEdit(
    areaId: string,
    polygonIndex = 0,
    controlMode: AreaEditControlMode = 'polygon',
    streetIndex: number | null = null
  ): void {
    if (!this.draftLitterPickEvent || this.draftLitterPickEvent.status === 'closed') {
      return;
    }

    const area = this.draftLitterPickEvent.areas.find((item) => item.id === areaId);
    if (!area || !this.areaCanEditMapCoverage(area)) {
      return;
    }

    const editablePolygons = this.areaCoveragePolygons(area);
    const nextPolygonIndex = this.clampPolygonIndex(polygonIndex, editablePolygons);
    const nextStreetIndex = controlMode === 'street' ? streetIndex : null;

    if (
      this.editingAreaId === areaId &&
      this.editingAreaPolygonIndex === nextPolygonIndex &&
      this.editingAreaControlMode === controlMode &&
      this.editingAreaStreetIndex === nextStreetIndex
    ) {
      this.setLitterPickMapMode('pan');
      return;
    }

    if (!this.isEditingLitterPick) {
      this.isEditingLitterPick = true;
    }

    this.activeAreaId = areaId;
    this.editingAreaId = areaId;
    this.editingAreaPolygonIndex = nextPolygonIndex;
    this.editingAreaControlMode = controlMode;
    this.editingAreaStreetIndex = nextStreetIndex;
    this.drawingAreaId = null;
    this.litterPickMapMode = 'edit';
    this.dragStart = null;
    this.draftAreaPoints = [];
    this.panState = undefined;
    this.areaEditDrag = undefined;
    this.areaStreetLookupMessages[areaId] =
      controlMode === 'street'
        ? 'Drag one of the four handles to adjust this street coverage shape.'
        : 'Drag the map handles to adjust this coverage shape.';
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
    if (this.drawingAreaId === areaId) {
      this.setLitterPickMapMode('pan');
    }
    delete this.newAreaStreetInputs[areaId];
    delete this.areaStreetLookupMessages[areaId];
    this.clearAreaStreetLookupBusy(areaId);
    clearTimeout(this.areaStreetLookupTimers[areaId]);
    delete this.areaStreetLookupTimers[areaId];
    delete this.areaStreetLookupTokens[areaId];
    this.clearAreaStreetPreview(areaId);
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

  areaHasMapCoverage(area: LitterPickArea): boolean {
    return this.areaCoveragePolygons(area).length > 0;
  }

  areaCanEditMapCoverage(area: LitterPickArea): boolean {
    return this.areaCoveragePolygons(area).length > 0;
  }

  areaCoveragePolygons(area: LitterPickArea): MapPoint[][] {
    const itemPolygons = this.coverageItemPolygons(this.normalizedAreaCoverageItems(area));
    if (itemPolygons.length) {
      return itemPolygons;
    }

    const generatedPolygons = (area.coveragePolygons || [])
      .map((polygon) => this.sanitizeAreaPoints(polygon || []))
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
    if (generatedPolygons.length) {
      return generatedPolygons;
    }

    const points = this.areaPoints(area);
    return points.length >= 3 ? [points] : [];
  }

  private editableAreaPolygon(area: LitterPickArea): MapPoint[] {
    const polygons = this.areaCoveragePolygons(area);
    if (!polygons.length) {
      return [];
    }

    return polygons[this.activeAreaPolygonIndex(area, polygons)].map((point) => ({ ...point }));
  }

  private editableAreaControlPoints(area: LitterPickArea): MapPoint[] {
    const polygon = this.editableAreaPolygon(area);
    if (this.editingAreaId === area.id && this.editingAreaControlMode === 'street') {
      return this.streetCoverageControlPoints(polygon);
    }

    return polygon;
  }

  private activeAreaPolygonIndex(area: LitterPickArea, polygons = this.areaCoveragePolygons(area)): number {
    return this.editingAreaId === area.id
      ? this.clampPolygonIndex(this.editingAreaPolygonIndex ?? 0, polygons)
      : 0;
  }

  private clampPolygonIndex(index: number, polygons: MapPoint[][]): number {
    return Math.max(0, Math.min(Math.trunc(index), Math.max(polygons.length - 1, 0)));
  }

  private streetCoveragePolygonIndex(area: LitterPickArea, streetIndex: number): number {
    return this.clampPolygonIndex(streetIndex, this.areaCoveragePolygons(area));
  }

  private streetCoverageControlPoints(points: MapPoint[]): MapPoint[] {
    if (points.length <= 4) {
      return points.map((point) => ({ ...point }));
    }

    const candidates = [
      this.extremePoint(points, (point) => point.x + point.y, 'min'),
      this.extremePoint(points, (point) => point.x - point.y, 'max'),
      this.extremePoint(points, (point) => point.x + point.y, 'max'),
      this.extremePoint(points, (point) => point.x - point.y, 'min')
    ];

    const uniqueCandidates = this.uniqueMapPoints(candidates);
    if (uniqueCandidates.length === 4) {
      return candidates.map((point) => ({ ...point }));
    }

    return [0, 0.25, 0.5, 0.75].map((ratio) => {
      const point = points[Math.floor(ratio * points.length)];
      return { ...point };
    });
  }

  private extremePoint(
    points: MapPoint[],
    score: (point: MapPoint) => number,
    direction: 'min' | 'max'
  ): MapPoint {
    return points.reduce((best, point) => {
      const value = score(point);
      const bestValue = score(best);
      return direction === 'min' ? (value < bestValue ? point : best) : value > bestValue ? point : best;
    }, points[0]);
  }

  mapPolygonPointsAttribute(points: MapPoint[]): string {
    return points
      .map((point) => this.boundaryPointToMapPosition(point))
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(' ');
  }

  areaStickerTransform(area: LitterPickArea): string {
    const position = this.boundaryPointToMapPosition(this.areaCentroid(area));
    return `translate(${position.x.toFixed(1)} ${position.y.toFixed(1)})`;
  }

  areaEditHandlePositions(area: LitterPickArea): MapPoint[] {
    return this.editableAreaControlPoints(area).map((point) => this.boundaryPointToMapPosition(point));
  }

  areaMoveHandlePosition(area: LitterPickArea): MapPoint {
    return this.boundaryPointToMapPosition(this.averagePoint(this.editableAreaPolygon(area)));
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
      const polygons = this.areaCoveragePolygons(area).map((polygon) =>
        polygon.map((point) => toCanvas(this.boundaryPointToLatLng(point)))
      );
      if (!polygons.length) {
        return;
      }

      polygons.forEach((points) => {
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
      });

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
      const polygons = this.areaCoveragePolygons(area);
      if (!polygons.length) {
        return;
      }

      polygons.forEach((points) => {
        this.addPdfPolygon(commands, points, rect, area.stickerTint || '#edf3ea', area.stickerStroke || '#8b5f3d', 1);
      });
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
        this.reportStateSaving = {};
        this.reportDeleting = {};
        const selectedReport = this.selectedReport;
        if (this.selectedReportId && (!selectedReport || !this.reportMatchesFilter(selectedReport))) {
          this.selectedReportId = null;
        }
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
        this.pendingUserRoles = users.reduce<Record<string, UserRole>>((roles, user) => {
          roles[user.id] = this.userRole(user);
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
      error: (error) => {
        this.errorMessage =
          error?.status === 403 && !this.canDeleteContent
            ? 'Editors can save event changes, but cannot delete events. Refresh the list and try again.'
            : 'Unable to save changes. Check the server or password.';
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
      error: (error) => {
        this.errorMessage =
          error?.status === 403 && !this.canDeleteContent
            ? 'Editors can save litter pick changes, but cannot delete litter pick events. Refresh the list and try again.'
            : 'Unable to save litter pick events. Check the server or password.';
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
          this.pendingUserRoles[updated.id] = this.userRole(updated);
          this.statusMessage = `Updated ${updated.email}.`;
        },
        error: () => {
          this.usersError = 'Unable to update user.';
        }
      });
  }

  private emptyUserForm(): { email: string; displayName: string; password: string; role: UserRole } {
    return {
      email: '',
      displayName: '',
      password: '',
      role: 'User'
    };
  }

  private isUserRole(role: string): role is UserRole {
    return role === 'Admin' || role === 'Editor' || role === 'User';
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
        const coverageItems = this.normalizedAreaCoverageItems(area);
        const itemPolygons = this.coverageItemPolygons(coverageItems);
        const streetNames = this.coverageItemStreetNames(coverageItems);
        return {
          ...area,
          label: this.teamLabel(area.label, sticker),
          points: itemPolygons.length === 1 ? itemPolygons[0] : area.points?.map((point) => ({ ...point })),
          coveragePolygons:
            itemPolygons.length > 1
              ? itemPolygons
              : area.coveragePolygons?.map((polygon) => polygon.map((point) => ({ ...point }))),
          coverageItems: coverageItems.map((item) => ({
            ...item,
            polygon: item.polygon?.map((point) => ({ ...point }))
          })),
          stickerIcon: sticker.icon,
          stickerLabel: sticker.label,
          stickerColor: sticker.color,
          stickerTint: sticker.tint,
          stickerStroke: sticker.stroke,
          bags: this.safeNumber(area.bags),
          volunteers: this.safeNumber(area.volunteers),
          streetNames,
          streets: streetNames.join(', ')
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
    const bounds = this.boundaryBounds();

    return HETHERSETT_BOUNDARY.map((point) => ({
      x: ((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100,
      y: ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * 100
    }));
  }

  private createCoverageSamplePoints(): MapPoint[] {
    const points: MapPoint[] = [];
    const bounds = this.boundaryPointBounds();
    const steps = 64;
    for (let row = 0; row < steps; row += 1) {
      for (let col = 0; col < steps; col += 1) {
        const point = {
          x: bounds.minX + ((col + 0.5) / steps) * (bounds.maxX - bounds.minX),
          y: bounds.minY + ((row + 0.5) / steps) * (bounds.maxY - bounds.minY)
        };
        if (this.isPointInsideBoundary(point)) {
          points.push(point);
        }
      }
    }
    return points;
  }

  private boundaryPointBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
      minX: Math.min(...this.mapBoundaryPoints.map((point) => point.x)),
      maxX: Math.max(...this.mapBoundaryPoints.map((point) => point.x)),
      minY: Math.min(...this.mapBoundaryPoints.map((point) => point.y)),
      maxY: Math.max(...this.mapBoundaryPoints.map((point) => point.y))
    };
  }

  private clampBoundaryMapPoint(point: MapPoint): MapPoint {
    const bounds = this.boundaryPointBounds();
    return {
      x: this.clamp(point.x, bounds.minX, bounds.maxX),
      y: this.clamp(point.y, bounds.minY, bounds.maxY)
    };
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
    const polygons = area ? this.areaCoveragePolygons(area) : [];
    const polygonIndex = this.clampPolygonIndex(this.editingAreaPolygonIndex ?? 0, polygons);
    const controlMode = this.editingAreaControlMode;
    const selectedPolygon = area && polygons[polygonIndex] ? polygons[polygonIndex].map((point) => ({ ...point })) : [];
    const originalPoints =
      kind === 'vertex' && controlMode === 'street'
        ? this.streetCoverageControlPoints(selectedPolygon)
        : selectedPolygon;
    if (!area || !startPoint || originalPoints.length < 3) {
      return;
    }

    this.activeAreaId = areaId;
    this.areaEditDrag = {
      pointerId: event.pointerId,
      areaId,
      polygonIndex,
      controlMode,
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
    if (this.polygonArea(nextPoints) < 0.2 || !this.isPolygonInsideBoundary(nextPoints)) {
      return;
    }

    this.updateEditableAreaPolygon(state.areaId, state.polygonIndex, nextPoints);
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

    this.updateEditableAreaPolygon(state.areaId, state.polygonIndex, nextPoints);
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
    const polygons = this.areaCoveragePolygons(area);
    return polygons.some((polygon) => this.isPointInPolygon(point, polygon));
  }

  private legacyAreaPoints(area: LitterPickArea): MapPoint[] {
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

    return this.legacyAreaPoints(area);
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
            coveragePolygons: undefined,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        : area
    );
  }

  private updateCoverageItemPolygon(areaId: string, itemIndex: number, points: MapPoint[]): void {
    if (!this.draftLitterPickEvent) {
      return;
    }

    const area = this.draftLitterPickEvent.areas.find((item) => item.id === areaId);
    if (!area) {
      return;
    }

    const items = this.normalizedAreaCoverageItems(area).map((item) => ({
      ...item,
      polygon: item.polygon?.map((point) => ({ ...point }))
    }));
    if (!items[itemIndex]) {
      return;
    }

    const sanitizedPoints = this.sanitizeAreaPoints(points);
    if (sanitizedPoints.length < 3 || this.polygonArea(sanitizedPoints) < 0.2) {
      return;
    }

    items[itemIndex] = {
      ...items[itemIndex],
      polygon: sanitizedPoints
    };
    this.replaceAreaCoverageItems(areaId, items);
  }

  private updateEditableAreaPolygon(areaId: string, polygonIndex: number, points: MapPoint[]): void {
    if (!this.draftLitterPickEvent) {
      return;
    }

    const area = this.draftLitterPickEvent.areas.find((item) => item.id === areaId);
    if (!area) {
      return;
    }

    const currentPolygons = this.areaCoveragePolygons(area);
    if (!currentPolygons.length) {
      return;
    }

    const safeIndex = this.clampPolygonIndex(polygonIndex, currentPolygons);
    const sanitizedPoints = this.sanitizeAreaPoints(points);
    if (sanitizedPoints.length < 3 || this.polygonArea(sanitizedPoints) < 0.2) {
      return;
    }

    if (this.editingAreaControlMode === 'street' && this.editingAreaStreetIndex !== null) {
      this.updateCoverageItemPolygon(areaId, this.editingAreaStreetIndex, sanitizedPoints);
      this.editingAreaPolygonIndex = safeIndex;
      return;
    }

    const nextPolygons = currentPolygons.map((polygon, index) =>
      index === safeIndex ? sanitizedPoints : polygon.map((point) => ({ ...point }))
    );
    const bounds = this.areaBounds(nextPolygons.flat());

    this.draftLitterPickEvent.areas = this.draftLitterPickEvent.areas.map((current) =>
      current.id === areaId
        ? {
            ...current,
            points: nextPolygons.length === 1 ? sanitizedPoints : undefined,
            coveragePolygons: nextPolygons.length > 1 ? nextPolygons : undefined,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        : current
    );
    this.editingAreaPolygonIndex = safeIndex;
  }

  private updateAreaCoveragePolygons(areaId: string, polygons: MapPoint[][]): void {
    if (!this.draftLitterPickEvent) {
      return;
    }

    const sanitizedPolygons = polygons
      .map((polygon) => this.sanitizeAreaPoints(polygon))
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
    if (!sanitizedPolygons.length) {
      return;
    }

    const primary = sanitizedPolygons[0];
    const bounds = this.areaBounds(sanitizedPolygons.flat());
    this.draftLitterPickEvent.areas = this.draftLitterPickEvent.areas.map((area) =>
      area.id === areaId
        ? {
            ...area,
            points: sanitizedPolygons.length === 1 ? primary : undefined,
            coveragePolygons: sanitizedPolygons.length > 1 ? sanitizedPolygons : undefined,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
        }
        : area
    );
    if (this.editingAreaId === areaId) {
      this.editingAreaPolygonIndex = this.clampPolygonIndex(this.editingAreaPolygonIndex ?? 0, sanitizedPolygons);
    }
  }

  private sanitizeAreaPoints(points: MapPoint[]): MapPoint[] {
    return points.map((point) => {
      const clipped = this.clampCoveragePoint(point);
      return {
        x: Number(clipped.x.toFixed(2)),
        y: Number(clipped.y.toFixed(2))
      };
    });
  }

  private areaCentroid(area: LitterPickArea): MapPoint {
    const points = this.areaCoveragePolygons(area).flat();
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
      const clippedPoint = this.clampBoundaryMapPoint(point);
      const clipped = {
        x: Number(clippedPoint.x.toFixed(2)),
        y: Number(clippedPoint.y.toFixed(2))
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

  private focusMapPoints(points: MapPoint[]): void {
    if (!points.length) {
      return;
    }

    const coordinates = points.map((point) => this.boundaryPointToLatLng(point));
    this.focusLatLngBounds({
      north: Math.max(...coordinates.map((point) => point.lat)),
      south: Math.min(...coordinates.map((point) => point.lat)),
      east: Math.max(...coordinates.map((point) => point.lng)),
      west: Math.min(...coordinates.map((point) => point.lng))
    });
  }

  private focusLatLngBounds(bounds: { north: number; south: number; east: number; west: number }): void {
    this.cancelPendingPanAnimation();
    this.pendingPanPosition = undefined;
    this.panState = undefined;
    this.litterPickCenterLat = (bounds.north + bounds.south) / 2;
    this.litterPickCenterLng = (bounds.east + bounds.west) / 2;
    this.litterPickZoom = this.mapZoomForLatLngBounds(bounds, 15.6, 17.6);
  }

  private mapZoomForLatLngBounds(
    bounds: { north: number; south: number; east: number; west: number },
    minZoom = 15.2,
    maxZoom = 17.2
  ): number {
    const fitWidth = Math.max(this.litterPickViewportWidth * 0.62, 220);
    const fitHeight = Math.max(this.litterPickViewportHeight * 0.62, 180);
    for (let zoom = maxZoom; zoom >= minZoom; zoom -= 0.25) {
      const northWest = this.latLngToPixel(bounds.north, bounds.west, zoom);
      const southEast = this.latLngToPixel(bounds.south, bounds.east, zoom);
      const width = Math.abs(southEast.x - northWest.x);
      const height = Math.abs(southEast.y - northWest.y);
      if (width <= fitWidth && height <= fitHeight) {
        return this.clamp(zoom, minZoom, maxZoom);
      }
    }

    return minZoom;
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

  private latLngToBoundaryPoint(point: BoundaryCoordinate, clampToBoundary = true): MapPoint {
    const bounds = this.boundaryBounds();
    const mapPoint = {
      x: ((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100,
      y: ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * 100
    };
    return clampToBoundary ? this.clampBoundaryMapPoint(mapPoint) : mapPoint;
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

  private createStreetCoverageItem(streetName = ''): LitterPickCoverageItem {
    const name = streetName.trim().replace(/\s+/g, ' ');
    return {
      id: this.createId('coverage'),
      kind: 'street',
      label: name,
      streetName: name
    };
  }

  private createDrawnCoverageItem(label = ''): LitterPickCoverageItem {
    return {
      id: this.createId('coverage'),
      kind: 'drawn',
      label: label.trim().replace(/\s+/g, ' ') || 'Drawn area'
    };
  }

  private normalizedAreaCoverageItems(area: LitterPickArea): LitterPickCoverageItem[] {
    if (Array.isArray(area.coverageItems)) {
      if (this.coverageItemsNeedNormalization(area.coverageItems)) {
        area.coverageItems = this.normalizeCoverageItems(area.coverageItems);
      }
      return area.coverageItems;
    }

    const legacyPolygons = (area.coveragePolygons || [])
      .map((polygon) => this.sanitizeAreaPoints(polygon || []))
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
    const streetNames = this.legacyAreaStreetNames(area);
    if (!streetNames.length) {
      return [];
    }

    area.coverageItems = streetNames.map((streetName, index) => ({
      ...this.createStreetCoverageItem(streetName),
      polygon: legacyPolygons[index]?.map((point) => ({ ...point }))
    }));
    return area.coverageItems;
  }

  private normalizeCoverageItems(items: LitterPickCoverageItem[]): LitterPickCoverageItem[] {
    return items
      .map((item, index) => {
        const kind: LitterPickCoverageItem['kind'] = item.kind === 'drawn' ? 'drawn' : 'street';
        const streetName = (item.streetName || (kind === 'street' ? item.label : '') || '').trim().replace(/\s+/g, ' ');
        const label = (item.label || streetName || (kind === 'drawn' ? `Drawn area ${index + 1}` : '')).trim().replace(/\s+/g, ' ');
        const polygon = item.polygon ? this.sanitizeAreaPoints(item.polygon) : undefined;
        const usablePolygon = polygon && polygon.length >= 3 && this.polygonArea(polygon) >= 0.2 ? polygon : undefined;

        return {
          id: item.id || this.createId('coverage'),
          kind,
          label,
          streetName: kind === 'street' ? streetName : undefined,
          polygon: usablePolygon
        };
      })
      .filter((item) => item.kind === 'drawn' || Boolean(item.streetName || item.polygon));
  }

  private coverageItemsNeedNormalization(items: LitterPickCoverageItem[]): boolean {
    return items.some((item) => {
      const kind = item.kind === 'drawn' || item.kind === 'street';
      const hasId = Boolean(item.id);
      const hasStreetName = item.kind !== 'street' || Boolean(item.streetName?.trim());
      const hasDrawnLabel = item.kind !== 'drawn' || Boolean(item.label?.trim());
      const hasUsablePolygon =
        !item.polygon ||
        (item.polygon.length >= 3 &&
          item.polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
      return !kind || !hasId || !hasStreetName || !hasDrawnLabel || !hasUsablePolygon;
    });
  }

  private coverageItemStreetNames(items: LitterPickCoverageItem[]): string[] {
    return this.uniqueStreetNames(items.filter((item) => item.kind === 'street').map((item) => item.streetName || ''));
  }

  private coverageItemPolygons(items: LitterPickCoverageItem[]): MapPoint[][] {
    return items
      .map((item) => item.polygon || [])
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
  }

  private coverageItemPolygonIndex(area: LitterPickArea, itemIndex: number): number {
    const items = this.normalizedAreaCoverageItems(area);
    if (!items[itemIndex]?.polygon) {
      return -1;
    }

    let polygonIndex = 0;
    for (let index = 0; index < itemIndex; index += 1) {
      const polygon = items[index].polygon;
      if (polygon && polygon.length >= 3 && this.polygonArea(polygon) >= 0.2) {
        polygonIndex += 1;
      }
    }

    return polygonIndex;
  }

  private replaceAreaCoverageItems(areaId: string, items: LitterPickCoverageItem[], syncPolygons = true): void {
    if (!this.draftLitterPickEvent) {
      return;
    }

    this.draftLitterPickEvent.areas = this.draftLitterPickEvent.areas.map((area) =>
      area.id === areaId ? this.areaWithCoverageItems(area, items, syncPolygons) : area
    );
  }

  private areaWithCoverageItems(
    area: LitterPickArea,
    items: LitterPickCoverageItem[],
    syncPolygons = true
  ): LitterPickArea {
    const coverageItems = this.normalizeCoverageItems(items);
    const streetNames = this.coverageItemStreetNames(coverageItems);
    const polygons = this.coverageItemPolygons(coverageItems);
    const bounds = polygons.length ? this.areaBounds(polygons.flat()) : null;

    return {
      ...area,
      coverageItems,
      streetNames,
      streets: streetNames.join(', '),
      ...(syncPolygons
        ? {
            points: polygons.length === 1 ? polygons[0] : undefined,
            coveragePolygons: polygons.length > 1 ? polygons : undefined,
            x: bounds?.x,
            y: bounds?.y,
            width: bounds?.width,
            height: bounds?.height
          }
        : {})
    };
  }

  private canEditAreaStreets(): boolean {
    return Boolean(this.draftLitterPickEvent && this.isEditingLitterPick && this.draftLitterPickEvent.status !== 'closed');
  }

  private commitAreaStreetRows(area: LitterPickArea, rows: string[], fieldKey = 'new'): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const streetNames = this.parseStreetNames(rows.join('\n'));
    area.streetNames = streetNames;
    area.streets = streetNames.join(', ');
    clearTimeout(this.areaStreetLookupTimers[area.id]);
    this.clearAreaStreetPreview(area.id);

    if (!streetNames.length) {
      this.areaStreetLookupTokens[area.id] = (this.areaStreetLookupTokens[area.id] || 0) + 1;
      this.areaStreetLookupMessages[area.id] = '';
      this.clearAreaMapCoverage(area.id);
      return;
    }

    this.areaStreetLookupMessages[area.id] =
      streetNames.length > 1 ? `Mapping ${streetNames.length} streets...` : 'Mapping street...';
    void this.mapAreaFromStreets(area.id, fieldKey);
  }

  private normalizedAreaStreetNames(area: LitterPickArea): string[] {
    if (Array.isArray(area.coverageItems)) {
      return this.coverageItemStreetNames(this.normalizedAreaCoverageItems(area));
    }

    return this.legacyAreaStreetNames(area);
  }

  private legacyAreaStreetNames(area: LitterPickArea): string[] {
    if (Array.isArray(area.streetNames)) {
      return this.uniqueStreetNames(area.streetNames);
    }

    return this.parseStreetNames(area.streets || '');
  }

  private scheduleAreaStreetPreview(areaId: string, value: string, fieldKey: string): void {
    if (!this.canEditAreaStreets()) {
      return;
    }

    clearTimeout(this.areaStreetPreviewTimers[areaId]);
    const streetName = this.parseStreetNames(value)[0] || '';
    if (streetName.length < 3) {
      this.clearAreaStreetPreview(areaId, true);
      this.clearAreaStreetLookupBusy(areaId);
      return;
    }

    this.areaStreetLookupMessages[areaId] = 'Previewing street shortly...';
    this.areaStreetPreviewTimers[areaId] = setTimeout(() => {
      void this.previewAreaStreet(areaId, streetName, fieldKey);
    }, 750);
  }

  private async previewAreaStreet(areaId: string, streetName: string, fieldKey: string): Promise<void> {
    if (!this.canEditAreaStreets()) {
      return;
    }

    const token = (this.areaStreetPreviewTokens[areaId] || 0) + 1;
    this.areaStreetPreviewTokens[areaId] = token;
    const operationId = `preview-${token}`;
    this.setAreaStreetLookupBusy(areaId, fieldKey, operationId);
    this.areaStreetLookupMessages[areaId] = 'Previewing street...';

    try {
      const result = await this.findHethersettStreet(streetName);
      if (this.areaStreetPreviewTokens[areaId] !== token) {
        return;
      }

      if (!result) {
        this.clearAreaStreetPreview(areaId);
        this.areaStreetLookupMessages[areaId] = 'No matching Hethersett street found yet.';
        return;
      }

      const polygons = this.streetSearchResultCoveragePolygons(result);
      if (!polygons.length) {
        this.clearAreaStreetPreview(areaId);
        this.areaStreetLookupMessages[areaId] = 'Found that street, but could not preview a usable area.';
        return;
      }

      this.areaStreetPreviewPolygons[areaId] = polygons;
      this.activeAreaId = areaId;
      this.focusStreetSearchResult(result);
      this.areaStreetLookupMessages[areaId] = `Previewing ${this.streetSearchLabel(result, streetName)}. Add it or press Enter to save.`;
    } catch {
      if (this.areaStreetPreviewTokens[areaId] === token) {
        this.clearAreaStreetPreview(areaId);
        this.areaStreetLookupMessages[areaId] = 'Street preview is unavailable right now.';
      }
    } finally {
      this.clearAreaStreetLookupBusy(areaId, operationId);
    }
  }

  private clearAreaStreetPreview(areaId: string, clearMessage = false): void {
    clearTimeout(this.areaStreetPreviewTimers[areaId]);
    delete this.areaStreetPreviewTimers[areaId];
    delete this.areaStreetPreviewPolygons[areaId];
    this.areaStreetPreviewTokens[areaId] = (this.areaStreetPreviewTokens[areaId] || 0) + 1;
    if (clearMessage) {
      this.areaStreetLookupMessages[areaId] = '';
    }
  }

  private setAreaStreetLookupBusy(areaId: string, fieldKey: string, operationId: string): void {
    this.areaStreetLookupBusy[areaId] = true;
    this.areaStreetLookupFields[areaId] = fieldKey;
    this.areaStreetLookupOperations[areaId] = operationId;
  }

  private clearAreaStreetLookupBusy(areaId: string, operationId?: string): void {
    if (operationId && this.areaStreetLookupOperations[areaId] !== operationId) {
      return;
    }

    delete this.areaStreetLookupBusy[areaId];
    delete this.areaStreetLookupFields[areaId];
    delete this.areaStreetLookupOperations[areaId];
  }

  private clearAreaMapCoverage(areaId: string): void {
    if (!this.draftLitterPickEvent) {
      return;
    }

    this.clearAreaStreetPreview(areaId);
    this.clearAreaStreetLookupBusy(areaId);
    this.draftLitterPickEvent.areas = this.draftLitterPickEvent.areas.map((area) =>
      area.id === areaId
        ? {
            ...area,
            points: undefined,
            coveragePolygons: undefined,
            x: undefined,
            y: undefined,
            width: undefined,
            height: undefined
          }
        : area
    );

    if (this.editingAreaId === areaId || this.drawingAreaId === areaId) {
      this.setLitterPickMapMode('pan');
    }
  }

  private async mapAreaFromStreets(areaId: string, fieldKey = 'new'): Promise<void> {
    const area = this.draftLitterPickEvent?.areas.find((item) => item.id === areaId);
    if (!area) {
      return;
    }

    const coverageItems = this.normalizedAreaCoverageItems(area).map((item) => ({
      ...item,
      polygon: item.polygon?.map((point) => ({ ...point }))
    }));
    const streetEntries = coverageItems
      .map((item, index) => ({ item, index, streetName: item.streetName?.trim() || '' }))
      .filter((entry) => entry.item.kind === 'street' && entry.streetName);
    if (!streetEntries.length) {
      this.areaStreetLookupMessages[areaId] = '';
      this.clearAreaMapCoverage(areaId);
      return;
    }

    const token = (this.areaStreetLookupTokens[areaId] || 0) + 1;
    this.areaStreetLookupTokens[areaId] = token;
    const operationId = `map-${token}`;
    this.setAreaStreetLookupBusy(areaId, fieldKey, operationId);
    this.areaStreetLookupMessages[areaId] =
      streetEntries.length > 1 ? `Mapping ${streetEntries.length} streets...` : 'Mapping street...';

    try {
      let mappedCount = 0;
      for (const [position, entry] of streetEntries.entries()) {
        const result = await this.findHethersettStreet(entry.streetName);
        if (result) {
          const polygon = this.streetSearchResultCoveragePolygons(result)[0];
          if (polygon) {
            coverageItems[entry.index] = {
              ...coverageItems[entry.index],
              label: entry.streetName,
              streetName: entry.streetName,
              polygon
            };
            mappedCount += 1;
          }
        }

        if (position < streetEntries.length - 1) {
          await this.sleep(1100);
        }
      }

      if (this.areaStreetLookupTokens[areaId] !== token) {
        return;
      }

      if (!mappedCount) {
        this.areaStreetLookupMessages[areaId] = 'No matching Hethersett streets found.';
        return;
      }

      this.replaceAreaCoverageItems(areaId, coverageItems);
      this.activeAreaId = areaId;
      const mappedText =
        mappedCount === streetEntries.length
          ? `Mapped ${mappedCount} street${mappedCount === 1 ? '' : 's'} to this team area.`
          : `Mapped ${mappedCount} of ${streetEntries.length} streets to this team area.`;
      this.areaStreetLookupMessages[areaId] = mappedText;
    } catch {
      if (this.areaStreetLookupTokens[areaId] === token) {
        this.areaStreetLookupMessages[areaId] = 'Street mapping is unavailable right now.';
      }
    } finally {
      this.clearAreaStreetLookupBusy(areaId, operationId);
    }
  }

  private parseStreetNames(value: string): string[] {
    return this.uniqueStreetNames(value.split(/[\n;,]+/));
  }

  private uniqueStreetNames(values: string[]): string[] {
    const names: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const name = value.trim().replace(/\s+/g, ' ');
      if (!name) {
        continue;
      }

      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      names.push(name);
      if (names.length >= 6) {
        break;
      }
    }

    return names;
  }

  private async findHethersettStreets(streetNames: string[]): Promise<StreetSearchResult[]> {
    const results: StreetSearchResult[] = [];
    for (const [index, streetName] of streetNames.entries()) {
      const result = await this.findHethersettStreet(streetName);
      if (result) {
        results.push(result);
      }
      if (index < streetNames.length - 1) {
        await this.sleep(1100);
      }
    }

    return results;
  }

  private streetSearchResultsToCoveragePolygons(results: StreetSearchResult[]): MapPoint[][] {
    return results.flatMap((result) => this.streetSearchResultCoveragePolygons(result));
  }

  private streetSearchResultCoveragePolygons(result: StreetSearchResult): MapPoint[][] {
    const streetLines = this.streetSearchResultLines(result);
    const combinedLine = this.combineStreetResultLines(streetLines);
    const combinedPolygon = combinedLine.length ? this.bufferStreetLine(combinedLine, 2.2) : [];
    const cleanedCombinedPolygon = this.simplifyCoveragePolygon(this.cleanStreetCoveragePolygon(combinedPolygon));
    if (cleanedCombinedPolygon.length >= 3 && this.polygonArea(cleanedCombinedPolygon) >= 0.2) {
      return [cleanedCombinedPolygon];
    }

    const linePolygons = streetLines
      .map((line) => this.simplifyCoveragePolygon(this.bufferStreetLine(line, 2.2)))
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
    if (linePolygons.length) {
      const unionPolygon = this.simplifyCoveragePolygon(this.unionStreetCoveragePolygons(linePolygons));
      return unionPolygon.length >= 3 && this.polygonArea(unionPolygon) >= 0.2 ? [unionPolygon] : linePolygons.slice(0, 1);
    }

    const fallback = this.streetSearchResultBoundaryPoints(result);
    return fallback.length >= 3 ? [fallback] : [];
  }

  private combineStreetResultLines(lines: MapPoint[][]): MapPoint[] {
    const points = this.uniqueMapPoints(lines.flat());
    if (points.length < 2) {
      return points;
    }

    const [start, end] = this.farthestMapPointPair(points);
    const axis = {
      x: end.x - start.x,
      y: end.y - start.y
    };
    const axisLength = Math.hypot(axis.x, axis.y);
    if (!axisLength) {
      return [];
    }

    return this.uniqueSequentialMapPoints(
      [...points].sort((a, b) => {
        const aProjection = (a.x - start.x) * axis.x + (a.y - start.y) * axis.y;
        const bProjection = (b.x - start.x) * axis.x + (b.y - start.y) * axis.y;
        return aProjection - bProjection;
      })
    );
  }

  private farthestMapPointPair(points: MapPoint[]): [MapPoint, MapPoint] {
    let pair: [MapPoint, MapPoint] = [points[0], points[1]];
    let maxDistance = this.distanceBetweenPoints(pair[0], pair[1]);

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const distance = this.distanceBetweenPoints(points[i], points[j]);
        if (distance > maxDistance) {
          maxDistance = distance;
          pair = [points[i], points[j]];
        }
      }
    }

    return pair;
  }

  private unionStreetCoveragePolygons(polygons: MapPoint[][]): MapPoint[] {
    const points = this.uniqueMapPoints(polygons.flat());
    if (points.length < 3) {
      return [];
    }

    return this.convexHull(points).map((point) => this.clampCoveragePoint(point));
  }

  private cleanStreetCoveragePolygon(points: MapPoint[]): MapPoint[] {
    const polygon = this.uniqueSequentialMapPoints(points);
    if (polygon.length < 3) {
      return polygon;
    }

    if (!this.hasPolygonSelfIntersections(polygon)) {
      return polygon;
    }

    const hull = this.convexHull(polygon);
    return hull.length >= 3 ? hull.map((point) => this.clampCoveragePoint(point)) : polygon;
  }

  private simplifyCoveragePolygon(points: MapPoint[], maxPoints = 72): MapPoint[] {
    const polygon = this.uniqueSequentialMapPoints(points);
    if (polygon.length <= maxPoints) {
      return polygon;
    }

    const step = polygon.length / maxPoints;
    const reduced = Array.from({ length: maxPoints }, (_value, index) => polygon[Math.floor(index * step)]);
    const simplified = this.uniqueSequentialMapPoints(reduced);
    return simplified.length >= 3 && this.polygonArea(simplified) >= 0.2 ? simplified : polygon;
  }

  private hasPolygonSelfIntersections(points: MapPoint[]): boolean {
    if (points.length < 4) {
      return false;
    }

    for (let i = 0; i < points.length; i += 1) {
      const firstStart = points[i];
      const firstEnd = points[(i + 1) % points.length];
      for (let j = i + 1; j < points.length; j += 1) {
        const isAdjacent = Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1);
        if (isAdjacent) {
          continue;
        }

        const secondStart = points[j];
        const secondEnd = points[(j + 1) % points.length];
        if (this.segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
          return true;
        }
      }
    }

    return false;
  }

  private segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
    const epsilon = 0.0001;
    const abC = this.crossProduct(a, b, c);
    const abD = this.crossProduct(a, b, d);
    const cdA = this.crossProduct(c, d, a);
    const cdB = this.crossProduct(c, d, b);

    if (Math.abs(abC) <= epsilon && this.isPointOnSegment(c, a, b)) {
      return true;
    }

    if (Math.abs(abD) <= epsilon && this.isPointOnSegment(d, a, b)) {
      return true;
    }

    if (Math.abs(cdA) <= epsilon && this.isPointOnSegment(a, c, d)) {
      return true;
    }

    if (Math.abs(cdB) <= epsilon && this.isPointOnSegment(b, c, d)) {
      return true;
    }

    return (abC > epsilon) !== (abD > epsilon) && (cdA > epsilon) !== (cdB > epsilon);
  }

  private isPointOnSegment(point: MapPoint, start: MapPoint, end: MapPoint): boolean {
    const epsilon = 0.0001;
    return (
      point.x >= Math.min(start.x, end.x) - epsilon &&
      point.x <= Math.max(start.x, end.x) + epsilon &&
      point.y >= Math.min(start.y, end.y) - epsilon &&
      point.y <= Math.max(start.y, end.y) + epsilon
    );
  }

  private convexHull(points: MapPoint[]): MapPoint[] {
    const sorted = this.uniqueMapPoints(points).sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    if (sorted.length <= 3) {
      return sorted;
    }

    const lower: MapPoint[] = [];
    for (const point of sorted) {
      while (lower.length >= 2 && this.crossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper: MapPoint[] = [];
    for (const point of [...sorted].reverse()) {
      while (upper.length >= 2 && this.crossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  private crossProduct(origin: MapPoint, a: MapPoint, b: MapPoint): number {
    return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  }

  private uniqueSequentialMapPoints(points: MapPoint[]): MapPoint[] {
    const result: MapPoint[] = [];
    for (const point of points) {
      const previous = result[result.length - 1];
      if (!previous || this.distanceBetweenPoints(previous, point) >= 0.01) {
        result.push(point);
      }
    }

    return result;
  }

  private streetSearchResultBoundaryPoints(result: StreetSearchResult): MapPoint[] {
    const bounds = this.expandedStreetSearchResultBounds(result);
    const coordinates = [
      { lat: bounds.north, lng: bounds.west },
      { lat: bounds.north, lng: bounds.east },
      { lat: bounds.south, lng: bounds.east },
      { lat: bounds.south, lng: bounds.west }
    ];

    return coordinates.map((coordinate) => this.streetSearchCoordinateToCoveragePoint(coordinate));
  }

  private streetSearchResultLines(result: StreetSearchResult): MapPoint[][] {
    const lines = this.geoJsonToLines(result.geojson);
    return lines
      .map((line) =>
        this.uniqueMapPoints(line.map((coordinate) => this.streetSearchCoordinateToCoveragePoint(coordinate)))
      )
      .filter((line) => line.length >= 2);
  }

  private geoJsonToLines(geojson: StreetGeoJson | undefined): BoundaryCoordinate[][] {
    if (!geojson?.type) {
      return [];
    }

    if (geojson.type === 'LineString') {
      const line = this.coordinatesToLatLngLine(geojson.coordinates);
      return line.length >= 2 ? [line] : [];
    }

    if (geojson.type === 'MultiLineString') {
      return Array.isArray(geojson.coordinates)
        ? geojson.coordinates
            .map((line) => this.coordinatesToLatLngLine(line))
            .filter((line) => line.length >= 2)
        : [];
    }

    if (geojson.type === 'Polygon') {
      const line = Array.isArray(geojson.coordinates) ? this.coordinatesToLatLngLine(geojson.coordinates[0]) : [];
      return line.length >= 2 ? [line] : [];
    }

    if (geojson.type === 'MultiPolygon') {
      return Array.isArray(geojson.coordinates)
        ? geojson.coordinates
            .map((polygon) => (Array.isArray(polygon) ? this.coordinatesToLatLngLine(polygon[0]) : []))
            .filter((line) => line.length >= 2)
        : [];
    }

    if (geojson.type === 'GeometryCollection') {
      return (geojson.geometries || []).flatMap((geometry) => this.geoJsonToLines(geometry));
    }

    return [];
  }

  private coordinatesToLatLngLine(coordinates: unknown): BoundaryCoordinate[] {
    if (!Array.isArray(coordinates)) {
      return [];
    }

    return coordinates
      .map((coordinate) => {
        if (!Array.isArray(coordinate) || coordinate.length < 2) {
          return null;
        }

        const lng = Number(coordinate[0]);
        const lat = Number(coordinate[1]);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      })
      .filter((coordinate): coordinate is BoundaryCoordinate => Boolean(coordinate));
  }

  private bufferStreetLine(line: MapPoint[], radius: number): MapPoint[] {
    if (line.length < 2) {
      return this.expandPointToArea(line[0] || this.boundaryAnchorPoint(), radius);
    }

    const left: MapPoint[] = [];
    const right: MapPoint[] = [];
    line.forEach((point, index) => {
      const normal = this.streetLineNormal(line, index);
      left.push(this.clampCoveragePoint({ x: point.x + normal.x * radius, y: point.y + normal.y * radius }));
      right.push(this.clampCoveragePoint({ x: point.x - normal.x * radius, y: point.y - normal.y * radius }));
    });

    const polygon = this.uniqueMapPoints([...left, ...right.reverse()]);
    if (polygon.length >= 3 && this.polygonArea(polygon) >= 0.2) {
      return polygon;
    }

    return this.expandPointToArea(this.averagePoint(line), radius);
  }

  private streetLineNormal(line: MapPoint[], index: number): MapPoint {
    const previous = line[Math.max(0, index - 1)];
    const current = line[index];
    const next = line[Math.min(line.length - 1, index + 1)];
    const firstNormal = this.segmentNormal(previous, current);
    const secondNormal = this.segmentNormal(current, next);
    const normal = {
      x: firstNormal.x + secondNormal.x,
      y: firstNormal.y + secondNormal.y
    };
    const length = Math.hypot(normal.x, normal.y);
    return length > 0 ? { x: normal.x / length, y: normal.y / length } : firstNormal;
  }

  private segmentNormal(start: MapPoint, end: MapPoint): MapPoint {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!length) {
      return { x: 0, y: -1 };
    }

    return {
      x: -dy / length,
      y: dx / length
    };
  }

  private expandedStreetSearchResultBounds(result: StreetSearchResult): {
    north: number;
    south: number;
    east: number;
    west: number;
  } {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    const bounds = this.streetSearchResultBounds(result) || {
      north: lat,
      south: lat,
      east: lng,
      west: lng
    };
    const latPadding = Math.max((bounds.north - bounds.south) * 0.18, 0.00035);
    const lngPadding = Math.max((bounds.east - bounds.west) * 0.18, 0.00045);

    return {
      north: bounds.north + latPadding,
      south: bounds.south - latPadding,
      east: bounds.east + lngPadding,
      west: bounds.west - lngPadding
    };
  }

  private streetSearchCoordinateToCoveragePoint(coordinate: BoundaryCoordinate): MapPoint {
    return this.clampCoveragePoint(this.latLngToBoundaryPoint(coordinate, false));
  }

  private clampCoveragePoint(point: MapPoint): MapPoint {
    const bounds = this.coveragePointBounds();
    return {
      x: this.clamp(point.x, bounds.minX, bounds.maxX),
      y: this.clamp(point.y, bounds.minY, bounds.maxY)
    };
  }

  private coveragePointBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const bounds = this.streetSearchBounds();
    const corners = [
      this.latLngToBoundaryPoint({ lat: bounds.north, lng: bounds.west }, false),
      this.latLngToBoundaryPoint({ lat: bounds.north, lng: bounds.east }, false),
      this.latLngToBoundaryPoint({ lat: bounds.south, lng: bounds.east }, false),
      this.latLngToBoundaryPoint({ lat: bounds.south, lng: bounds.west }, false)
    ];

    return {
      minX: Math.min(...corners.map((point) => point.x)),
      maxX: Math.max(...corners.map((point) => point.x)),
      minY: Math.min(...corners.map((point) => point.y)),
      maxY: Math.max(...corners.map((point) => point.y))
    };
  }

  private boundaryAnchorPoint(): MapPoint {
    const average = this.averagePoint(this.mapBoundaryPoints);
    return this.isPointInsideBoundary(average) ? average : { x: 50, y: 50 };
  }

  private uniqueMapPoints(points: MapPoint[]): MapPoint[] {
    const seen = new Set<string>();
    return points.filter((point) => {
      const key = `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private expandPointToArea(point: MapPoint, radius: number): MapPoint[] {
    return [
      { x: point.x - radius, y: point.y - radius },
      { x: point.x + radius, y: point.y - radius },
      { x: point.x + radius, y: point.y + radius },
      { x: point.x - radius, y: point.y + radius }
    ].map((candidate) => this.clampCoveragePoint(candidate));
  }

  private averagePoint(points: MapPoint[]): MapPoint {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async findHethersettStreet(query: string): Promise<StreetSearchResult | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      q: `${query}, Hethersett, Norfolk, United Kingdom`,
      addressdetails: '1',
      polygon_geojson: '1',
      countrycodes: 'gb',
      limit: '20',
      dedupe: '0',
      bounded: '1',
      viewbox: this.streetSearchViewBox()
    });
    const token = this.authService.token;
    const response = await fetch(`/api/street-search?${params.toString()}`, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (!response.ok) {
      throw new Error('Street search failed.');
    }

    const results = (await response.json()) as unknown;
    if (!Array.isArray(results)) {
      return null;
    }

    const candidates = (results as StreetSearchResult[]).filter((result) => this.isStreetSearchResultInBounds(result));
    if (!candidates.length) {
      return null;
    }

    const roadLineMatches = candidates
      .filter((result) => this.isRoadLikeStreetSearchResult(result))
      .filter((result) => this.streetSearchResultLines(result).length > 0)
      .filter((result) => this.streetSearchResultMatchesQuery(result, query));

    if (roadLineMatches.length) {
      const rankedRoads = this.sortStreetSearchResults(roadLineMatches, query);
      const exactRoads = rankedRoads.filter((result) => this.streetSearchResultPrimaryNameMatches(result, query));
      const selectedRoads = exactRoads.length ? exactRoads : rankedRoads.slice(0, 1);
      return this.mergeStreetSearchResults(selectedRoads, query);
    }

    return this.sortStreetSearchResults(candidates, query)[0] || null;
  }

  private sortStreetSearchResults(results: StreetSearchResult[], query: string): StreetSearchResult[] {
    return [...results].sort(
      (a, b) => this.streetSearchResultScore(b, query) - this.streetSearchResultScore(a, query)
    );
  }

  private streetSearchResultScore(result: StreetSearchResult, query: string): number {
    const roadLike = this.isRoadLikeStreetSearchResult(result);
    const lineCount = this.streetSearchResultLines(result).length;
    const geoType = (result.geojson?.type || '').toLowerCase();
    const category = this.streetSearchResultCategory(result);
    const addresstype = (result.addresstype || '').toLowerCase();
    const type = (result.type || '').toLowerCase();
    let score = 0;

    if (this.streetSearchResultPrimaryNameMatches(result, query)) {
      score += 140;
    } else if (this.streetSearchResultMatchesQuery(result, query)) {
      score += 55;
    }

    if (roadLike) {
      score += 95;
    }

    if (lineCount > 0) {
      score += 85 + Math.min(this.streetSearchLineLength(result) * 2200, 70);
    }

    if (geoType === 'multilinestring' || geoType === 'geometrycollection') {
      score += 18;
    }

    if (geoType === 'point' || lineCount === 0) {
      score -= 90;
    }

    if (['building', 'amenity', 'shop', 'tourism', 'place'].includes(category)) {
      score -= 55;
    }

    if (['house', 'building', 'amenity', 'postcode'].includes(addresstype) || type === 'house') {
      score -= 70;
    }

    score += this.safeNumber(Number(result.importance)) * 8;
    return score;
  }

  private isRoadLikeStreetSearchResult(result: StreetSearchResult): boolean {
    const category = this.streetSearchResultCategory(result);
    const type = (result.type || '').toLowerCase();
    const addresstype = (result.addresstype || '').toLowerCase();
    const roadTypes = new Set([
      'road',
      'residential',
      'tertiary',
      'secondary',
      'primary',
      'unclassified',
      'service',
      'living_street',
      'pedestrian'
    ]);

    return category === 'highway' || addresstype === 'road' || roadTypes.has(type);
  }

  private streetSearchResultCategory(result: StreetSearchResult): string {
    return (result.category || result.class || '').toLowerCase();
  }

  private streetSearchResultMatchesQuery(result: StreetSearchResult, query: string): boolean {
    const normalizedQuery = this.normalizeStreetSearchName(query);
    const displayName = this.normalizeStreetSearchName(result.display_name || '');
    const primaryName = this.normalizeStreetSearchName(this.streetSearchPrimaryName(result));
    return primaryName === normalizedQuery || primaryName.includes(normalizedQuery) || displayName.includes(normalizedQuery);
  }

  private streetSearchResultPrimaryNameMatches(result: StreetSearchResult, query: string): boolean {
    return this.normalizeStreetSearchName(this.streetSearchPrimaryName(result)) === this.normalizeStreetSearchName(query);
  }

  private streetSearchPrimaryName(result: StreetSearchResult): string {
    return result.name?.trim() || result.display_name?.split(',')[0]?.trim() || '';
  }

  private normalizeStreetSearchName(value: string): string {
    return value
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private streetSearchLineLength(result: StreetSearchResult): number {
    return this.geoJsonToLines(result.geojson).reduce((total, line) => {
      const length = line.reduce((lineTotal, point, index) => {
        if (index === 0) {
          return lineTotal;
        }

        const previous = line[index - 1];
        return lineTotal + Math.hypot(point.lat - previous.lat, point.lng - previous.lng);
      }, 0);
      return total + length;
    }, 0);
  }

  private mergeStreetSearchResults(results: StreetSearchResult[], query: string): StreetSearchResult {
    if (results.length === 1) {
      return results[0];
    }

    const geojsonResults = results.map((result) => result.geojson).filter((geojson): geojson is StreetGeoJson => Boolean(geojson));
    const latValues = results.map((result) => Number(result.lat)).filter(Number.isFinite);
    const lngValues = results.map((result) => Number(result.lon)).filter(Number.isFinite);
    const bounds = results
      .map((result) => this.streetSearchResultBounds(result))
      .filter((item): item is { north: number; south: number; east: number; west: number } => Boolean(item));
    const first = results[0];

    return {
      ...first,
      lat: String(latValues.length ? latValues.reduce((sum, value) => sum + value, 0) / latValues.length : first.lat),
      lon: String(lngValues.length ? lngValues.reduce((sum, value) => sum + value, 0) / lngValues.length : first.lon),
      category: 'highway',
      class: 'highway',
      addresstype: 'road',
      name: query,
      display_name: `${query}, Hethersett, Norfolk, United Kingdom`,
      boundingbox: bounds.length
        ? [
            Math.min(...bounds.map((bound) => bound.south)).toString(),
            Math.max(...bounds.map((bound) => bound.north)).toString(),
            Math.min(...bounds.map((bound) => bound.west)).toString(),
            Math.max(...bounds.map((bound) => bound.east)).toString()
          ]
        : first.boundingbox,
      geojson:
        geojsonResults.length > 1
          ? {
              type: 'GeometryCollection',
              geometries: geojsonResults
            }
          : geojsonResults[0]
    };
  }

  private streetSearchZoomFor(result: StreetSearchResult): number {
    const bounds = this.streetSearchResultBounds(result);
    if (!bounds) {
      return 16.7;
    }

    return this.mapZoomForLatLngBounds(bounds, 15.2, 17.2);
  }

  private focusStreetSearchResult(result: StreetSearchResult): void {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    this.litterPickCenterLat = lat;
    this.litterPickCenterLng = lng;
    this.litterPickZoom = this.streetSearchZoomFor(result);
    this.panState = undefined;
  }

  private streetSearchLabel(result: StreetSearchResult, fallback: string): string {
    return result.display_name?.split(',')[0]?.trim() || fallback;
  }

  private streetSearchViewBox(): string {
    const bounds = this.streetSearchBounds();
    return [
      bounds.west.toFixed(5),
      bounds.north.toFixed(5),
      bounds.east.toFixed(5),
      bounds.south.toFixed(5)
    ].join(',');
  }

  private streetSearchBounds(): { north: number; south: number; east: number; west: number } {
    const bounds = this.boundaryBounds();
    return {
      north: bounds.maxLat + 0.025,
      south: bounds.minLat - 0.025,
      east: bounds.maxLng + 0.035,
      west: bounds.minLng - 0.035
    };
  }

  private isStreetSearchResultInBounds(result: StreetSearchResult): boolean {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return false;
    }

    const bounds = this.streetSearchBounds();
    return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
  }

  private streetSearchResultBounds(
    result: StreetSearchResult
  ): { north: number; south: number; east: number; west: number } | null {
    if (!result.boundingbox || result.boundingbox.length < 4) {
      return null;
    }

    const [south, north, west, east] = result.boundingbox.map(Number);
    if (![south, north, west, east].every(Number.isFinite) || south === north || west === east) {
      return null;
    }

    return { north, south, east, west };
  }

  private boundaryBounds(): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
    return HETHERSETT_MAP_BOUNDS;
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
