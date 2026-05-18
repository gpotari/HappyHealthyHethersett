import { Component } from '@angular/core';
import { HeroComponent } from './hero.component';
import { NewsComponent } from './news.component';
import { PocketForestGalleryComponent } from './pocket-forest-gallery.component';
import { EventsComponent } from './events.component';
import { LitterPickEventsComponent } from './litter-pick-events.component';
import { ProjectsComponent } from './projects.component';
import { ContactComponent } from './contact.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    HeroComponent,
    NewsComponent,
    PocketForestGalleryComponent,
    EventsComponent,
    LitterPickEventsComponent,
    ProjectsComponent,
    ContactComponent
  ],
  templateUrl: './home.component.html'
})
export class HomeComponent {}
