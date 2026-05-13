import { Routes } from '@angular/router';
import { HomeComponent } from './components/home.component';
import { MiyawakiTimelinePageComponent } from './components/miyawaki-timeline-page.component';
import { AdminEventsComponent } from './components/admin-events.component';
import { ReportLitterComponent } from './components/report-litter.component';
import { PrivacyCookiesComponent } from './components/privacy-cookies.component';

export const appRoutes: Routes = [
  {
    path: '',
    component: HomeComponent
  },
  {
    path: 'miyawaki-timeline',
    component: MiyawakiTimelinePageComponent
  },
  {
    path: 'report-litter',
    component: ReportLitterComponent
  },
  {
    path: 'privacy-cookies',
    component: PrivacyCookiesComponent
  },
  {
    path: 'admin',
    component: AdminEventsComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
