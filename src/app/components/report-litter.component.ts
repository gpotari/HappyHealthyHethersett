import { CommonModule } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LitterReport } from '../models/litter-report';
import { PhotoAttachment } from '../models/photo-attachment';
import { LitterReportsService } from '../services/litter-reports.service';

type ReportPoint = {
  lat: number;
  lng: number;
  label: string;
};

type MapTile = {
  key: string;
  url: string;
  left: number;
  top: number;
};

type PixelPoint = {
  x: number;
  y: number;
};

@Component({
  selector: 'app-report-litter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-litter.component.html',
  styleUrls: ['./report-litter.component.css']
})
export class ReportLitterComponent implements AfterViewInit, OnDestroy {
  private readonly maxReportPhotos = 8;
  private readonly uploadPhotoMaxEdge = 1400;
  private readonly uploadPhotoQuality = 0.78;

  selectedPoint?: ReportPoint;
  comment = '';
  contact = '';
  litterAmount = '';
  reportPrepared = false;
  submitting = false;
  submitProgress = 0;
  submitProgressMessage = '';
  submitError = '';
  copyStatus = '';
  locationStatus = '';
  locating = false;
  submittedReport?: LitterReport;
  reportPhotos: PhotoAttachment[] = [];

  zoom = 14;
  readonly minZoom = 13;
  readonly maxZoom = 18;
  readonly tileSize = 256;
  centerLat = 52.59761;
  centerLng = 1.17359;
  viewportWidth = 760;
  viewportHeight = 520;

  @ViewChild('reportMap') reportMap?: ElementRef<HTMLElement>;

  private resizeObserver?: ResizeObserver;
  private submitUploadTotal = 0;
  private dragState?: {
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: PixelPoint;
    dragged: boolean;
  };

  constructor(private litterReportsService: LitterReportsService) {}

  ngAfterViewInit(): void {
    this.updateViewportSize();

    if (typeof ResizeObserver !== 'undefined' && this.reportMap?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => this.updateViewportSize());
      this.resizeObserver.observe(this.reportMap.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  get visibleTiles(): MapTile[] {
    const center = this.latLngToPixel(this.centerLat, this.centerLng, this.zoom);
    const leftWorld = center.x - this.viewportWidth / 2;
    const topWorld = center.y - this.viewportHeight / 2;
    const firstTileX = Math.floor(leftWorld / this.tileSize);
    const firstTileY = Math.floor(topWorld / this.tileSize);
    const lastTileX = Math.floor((leftWorld + this.viewportWidth) / this.tileSize);
    const lastTileY = Math.floor((topWorld + this.viewportHeight) / this.tileSize);
    const maxTile = 2 ** this.zoom;
    const tiles: MapTile[] = [];

    for (let x = firstTileX; x <= lastTileX; x += 1) {
      for (let y = firstTileY; y <= lastTileY; y += 1) {
        if (y < 0 || y >= maxTile) {
          continue;
        }

        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        const shard = ['a', 'b', 'c'][(wrappedX + y) % 3];
        tiles.push({
          key: `${this.zoom}-${wrappedX}-${y}`,
          url: `https://${shard}.basemaps.cartocdn.com/rastertiles/voyager/${this.zoom}/${wrappedX}/${y}@2x.png`,
          left: x * this.tileSize - leftWorld,
          top: y * this.tileSize - topWorld
        });
      }
    }

    return tiles;
  }

  get selectedLocationText(): string {
    if (!this.selectedPoint) {
      return 'No location selected yet';
    }

    return `${this.selectedPoint.label} · ${this.selectedPoint.lat.toFixed(5)}, ${this.selectedPoint.lng.toFixed(5)}`;
  }

  get reportSummary(): string {
    const report = this.submittedReport ?? this.currentReportPayload();
    if (!report) {
      return '';
    }

    const parts = [
      'Litter report for Happy Healthy Hethersett',
      '',
      `Location: ${report.locationLabel}`,
      `Coordinates: ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`,
      `Map link: ${report.mapLink}`,
      `Amount of litter: ${report.amount || 'Not specified.'}`,
      `Details: ${report.comment || 'No extra details provided.'}`,
      `Reporter contact: ${report.contact || 'Not provided.'}`,
      `Photos attached: ${report.photos?.length || 0}`
    ];

    return parts.join('\n');
  }

  get mapLink(): string {
    if (!this.selectedPoint) {
      return '';
    }

    const { lat, lng } = this.selectedPoint;
    return `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  }

  mapPositionFor(point: ReportPoint): PixelPoint {
    const center = this.latLngToPixel(this.centerLat, this.centerLng, this.zoom);
    const pixel = this.latLngToPixel(point.lat, point.lng, this.zoom);

    return {
      x: pixel.x - center.x + this.viewportWidth / 2,
      y: pixel.y - center.y + this.viewportHeight / 2
    };
  }

  zoomIn(): void {
    this.setZoom(this.zoom + 1);
  }

  zoomOut(): void {
    this.setZoom(this.zoom - 1);
  }

  resetMap(): void {
    this.centerLat = 52.59761;
    this.centerLng = 1.17359;
    this.zoom = 14;
  }

  useCurrentLocation(): void {
    if (!navigator.geolocation) {
      this.locationStatus = 'Current location is not available in this browser.';
      return;
    }

    this.locating = true;
    this.locationStatus = 'Finding your location...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        this.centerLat = lat;
        this.centerLng = lng;
        this.zoom = Math.max(this.zoom, 17);
        this.selectPoint(lat, lng, 'Current location');
        this.locationStatus = `Location found to about ${Math.round(position.coords.accuracy)} metres.`;
        this.locating = false;
      },
      (error) => {
        this.locationStatus = this.locationErrorMessage(error);
        this.locating = false;
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }

  onMapPointerDown(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement) || this.isInteractiveTarget(event.target)) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: this.latLngToPixel(this.centerLat, this.centerLng, this.zoom),
      dragged: false
    };
  }

  onMapPointerMove(event: PointerEvent): void {
    if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - this.dragState.startX;
    const dy = event.clientY - this.dragState.startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      this.dragState.dragged = true;
    }

    const center = {
      x: this.dragState.startCenter.x - dx,
      y: this.dragState.startCenter.y - dy
    };
    const nextCenter = this.pixelToLatLng(center.x, center.y, this.zoom);
    this.centerLat = nextCenter.lat;
    this.centerLng = nextCenter.lng;
  }

  onMapPointerUp(event: PointerEvent): void {
    if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
      return;
    }

    const wasDragged = this.dragState.dragged;
    this.dragState = undefined;

    if (!wasDragged) {
      this.selectPointFromClientPosition(event.clientX, event.clientY, 'Selected map point');
    }
  }

  onMapWheel(event: WheelEvent): void {
    event.preventDefault();

    if (!this.reportMap?.nativeElement) {
      return;
    }

    const nextZoom = this.clamp(this.zoom + (event.deltaY < 0 ? 1 : -1), this.minZoom, this.maxZoom);
    if (nextZoom === this.zoom) {
      return;
    }

    const rect = this.reportMap.nativeElement.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const cursorLatLng = this.clientOffsetToLatLng(cursorX, cursorY);
    const cursorPixelAtNextZoom = this.latLngToPixel(cursorLatLng.lat, cursorLatLng.lng, nextZoom);
    const nextCenterPixel = {
      x: cursorPixelAtNextZoom.x - (cursorX - this.viewportWidth / 2),
      y: cursorPixelAtNextZoom.y - (cursorY - this.viewportHeight / 2)
    };
    const nextCenter = this.pixelToLatLng(nextCenterPixel.x, nextCenterPixel.y, nextZoom);

    this.zoom = nextZoom;
    this.centerLat = nextCenter.lat;
    this.centerLng = nextCenter.lng;
  }

  handleMapKeydown(event: KeyboardEvent): void {
    const panStep = event.shiftKey ? 140 : 70;
    const center = this.latLngToPixel(this.centerLat, this.centerLng, this.zoom);

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.zoomIn();
      return;
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.zoomOut();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectPoint(this.centerLat, this.centerLng, 'Selected map centre');
      return;
    }

    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const nextCenterPixel = {
      x: center.x + (event.key === 'ArrowRight' ? panStep : event.key === 'ArrowLeft' ? -panStep : 0),
      y: center.y + (event.key === 'ArrowDown' ? panStep : event.key === 'ArrowUp' ? -panStep : 0)
    };
    const nextCenter = this.pixelToLatLng(nextCenterPixel.x, nextCenterPixel.y, this.zoom);
    this.centerLat = nextCenter.lat;
    this.centerLng = nextCenter.lng;
  }

  submitReport(): void {
    const report = this.currentReportPayload();
    if (!report) {
      return;
    }

    this.submitting = true;
    this.submitProgress = 0;
    this.submitProgressMessage = 'Preparing report...';
    this.submitUploadTotal = this.estimateReportUploadSize(report);
    this.submitError = '';
    this.reportPrepared = false;
    this.copyStatus = '';

    this.litterReportsService.submitReportWithProgress(report).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.Sent) {
          this.setSubmitProgress(1, 'Preparing report...');
          return;
        }

        if (event.type === HttpEventType.UploadProgress) {
          const progress = this.uploadProgressPercent(event.loaded, event.total);
          this.setSubmitProgress(
            progress,
            progress >= 99 ? 'Saving report...' : this.uploadProgressMessage()
          );
          return;
        }

        if (event.type === HttpEventType.Response) {
          this.submittedReport = event.body ?? report;
          this.reportPrepared = true;
          this.setSubmitProgress(100, 'Report submitted.');
          this.submitting = false;
        }
      },
      error: () => {
        this.submitError = 'Unable to submit the report. Please check the server and try again.';
        this.submitting = false;
        this.submitProgress = 0;
        this.submitProgressMessage = '';
      }
    });
  }

  async onReportPhotosSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) {
      return;
    }

    this.submitError = '';
    try {
      const availableSlots = Math.max(0, this.maxReportPhotos - this.reportPhotos.length);
      if (!availableSlots) {
        this.submitError = `You can attach up to ${this.maxReportPhotos} photos.`;
        return;
      }

      const photos = await Promise.all(
        files
          .filter((file) => file.type.startsWith('image/'))
          .slice(0, availableSlots)
          .map((file) => this.createPhotoAttachment(file))
      );

      if (!photos.length) {
        this.submitError = 'Please choose image files to attach.';
        return;
      }

      this.reportPhotos = [...this.reportPhotos, ...photos];
    } catch {
      this.submitError = 'Unable to read one of those photos.';
    } finally {
      input.value = '';
    }
  }

  removeReportPhoto(index: number): void {
    this.reportPhotos = this.reportPhotos.filter((_, photoIndex) => photoIndex !== index);
  }

  copyReport(): void {
    if (!this.selectedPoint) {
      return;
    }

    const summary = this.reportSummary;

    if (!navigator.clipboard) {
      this.copyStatus = 'Report summary ready below.';
      return;
    }

    navigator.clipboard
      .writeText(summary)
      .then(() => {
        this.copyStatus = 'Report summary copied.';
      })
      .catch(() => {
        this.copyStatus = 'Copy failed. You can still select the summary text.';
      });
  }

  private selectPointFromClientPosition(clientX: number, clientY: number, label: string): void {
    if (!this.reportMap?.nativeElement) {
      return;
    }

    const rect = this.reportMap.nativeElement.getBoundingClientRect();
    const latLng = this.clientOffsetToLatLng(clientX - rect.left, clientY - rect.top);
    this.selectPoint(latLng.lat, latLng.lng, label);
  }

  private selectPoint(lat: number, lng: number, label: string): void {
    this.selectedPoint = {
      lat: this.clamp(lat, 52.585, 52.611),
      lng: this.clamp(lng, 1.145, 1.205),
      label
    };
    this.reportPrepared = false;
    this.copyStatus = '';
    this.submitError = '';
    this.submittedReport = undefined;
  }

  private setZoom(nextZoom: number): void {
    this.zoom = this.clamp(nextZoom, this.minZoom, this.maxZoom);
  }

  private clientOffsetToLatLng(offsetX: number, offsetY: number): { lat: number; lng: number } {
    const center = this.latLngToPixel(this.centerLat, this.centerLng, this.zoom);
    const worldX = center.x + (offsetX - this.viewportWidth / 2);
    const worldY = center.y + (offsetY - this.viewportHeight / 2);
    return this.pixelToLatLng(worldX, worldY, this.zoom);
  }

  private updateViewportSize(): void {
    if (!this.reportMap?.nativeElement) {
      return;
    }

    const rect = this.reportMap.nativeElement.getBoundingClientRect();
    this.viewportWidth = rect.width;
    this.viewportHeight = rect.height;
  }

  private latLngToPixel(lat: number, lng: number, zoom: number): PixelPoint {
    const sinLat = Math.sin((this.clamp(lat, -85.0511, 85.0511) * Math.PI) / 180);
    const scale = this.tileSize * 2 ** zoom;

    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
    };
  }

  private pixelToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
    const scale = this.tileSize * 2 ** zoom;
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

    return { lat, lng };
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest('button, a, input, textarea, select'));
  }

  private locationErrorMessage(error: GeolocationPositionError): string {
    if (error.code === error.PERMISSION_DENIED) {
      return 'Location permission was denied. You can still tap the map to choose the spot.';
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
      return 'Your location could not be found. Try again outside or choose the spot manually.';
    }

    if (error.code === error.TIMEOUT) {
      return 'Finding your location took too long. Try again or choose the spot manually.';
    }

    return 'Your location could not be found. You can still choose the spot manually.';
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private setSubmitProgress(value: number, message: string): void {
    this.submitProgress = this.clamp(Math.round(value), 0, 100);
    this.submitProgressMessage = message;
  }

  private uploadProgressPercent(loaded: number, total?: number): number {
    const totalBytes = Math.max(total ?? this.submitUploadTotal, loaded, 1);
    return this.clamp(Math.round((loaded / totalBytes) * 100), 1, 99);
  }

  private uploadProgressMessage(): string {
    return this.reportPhotos.length ? 'Uploading photos and report...' : 'Uploading report...';
  }

  private estimateReportUploadSize(report: LitterReport): number {
    const payload = JSON.stringify(report);
    if (typeof TextEncoder === 'undefined') {
      return Math.max(payload.length, 1);
    }

    return Math.max(new TextEncoder().encode(payload).length, 1);
  }

  private currentReportPayload(): LitterReport | null {
    if (!this.selectedPoint) {
      return null;
    }

    return {
      locationLabel: this.selectedPoint.label,
      lat: this.selectedPoint.lat,
      lng: this.selectedPoint.lng,
      amount: this.litterAmount,
      comment: this.comment.trim(),
      contact: this.contact.trim(),
      mapLink: this.mapLink,
      photos: this.reportPhotos.map((photo) => ({ ...photo }))
    };
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
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private dataUrlContentType(value?: string): string | null {
    const match = /^data:([^;,]+)[;,]/.exec(value || '');
    return match?.[1] || null;
  }
}
