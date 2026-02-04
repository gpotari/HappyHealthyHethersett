import { Component } from '@angular/core';
import { HeaderComponent } from './components/header.component';
import { HeroComponent } from './components/hero.component';
import { NewsComponent } from './components/news.component';
import { PocketForestGalleryComponent } from './components/pocket-forest-gallery.component';
import { MiyawakiTimelineComponent } from './components/miyawaki-timeline.component';
import { EventsComponent } from './components/events.component';
import { ProjectsComponent } from './components/projects.component';
import { StoriesComponent } from './components/stories.component';
import { ContactComponent } from './components/contact.component';
import { FooterComponent } from './components/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    HeaderComponent,
    HeroComponent,
    NewsComponent,
    PocketForestGalleryComponent,
    MiyawakiTimelineComponent,
    EventsComponent,
    ProjectsComponent,
    StoriesComponent,
    ContactComponent,
    FooterComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {}
