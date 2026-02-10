import { Routes } from '@angular/router';
import { HomeComponent } from './components/home.component';
import { MiyawakiTimelinePageComponent } from './components/miyawaki-timeline-page.component';

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
    path: '**',
    redirectTo: ''
  }
];
