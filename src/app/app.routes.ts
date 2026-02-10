import { Routes } from '@angular/router';
import { HomeComponent } from './components/home.component';
import { MiyawakiTimelinePageComponent } from './components/miyawaki-timeline-page.component';
import { AdminEventsComponent } from './components/admin-events.component';

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
    path: 'admin',
    component: AdminEventsComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
