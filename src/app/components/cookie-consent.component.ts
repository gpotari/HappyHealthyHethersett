import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../services/analytics.service';

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './cookie-consent.component.html'
})
export class CookieConsentComponent {
  readonly analytics = inject(AnalyticsService);

  acceptAnalytics(): void {
    this.analytics.acceptAnalytics();
  }

  declineAnalytics(): void {
    this.analytics.declineAnalytics();
  }
}
