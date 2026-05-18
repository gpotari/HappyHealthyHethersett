import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, QueryList, ViewChild, ViewChildren } from '@angular/core';

type TimelineImage = {
  thumbSrc: string;
  lightboxSrc: string;
  fallbackSrc: string;
  alt: string;
};

@Component({
  selector: 'app-miyawaki-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './miyawaki-timeline.component.html',
  styleUrls: ['./miyawaki-timeline.component.css']
})
export class MiyawakiTimelineComponent {
  workBeginsImages: TimelineImage[] = [
    this.timelineImage('work-begins-01', 'Village Hall field marked out before the pocket forest groundwork begins.'),
    this.timelineImage('work-begins-02', 'Prepared pocket forest plot with fencing and soil improvement underway.'),
    this.timelineImage('work-begins-03', 'Excavator lifting turf during the first stage of ground preparation.'),
    this.timelineImage('work-begins-04', 'Compost and soil improver ready beside the prepared planting area.'),
    this.timelineImage('work-begins-05', 'Rich compost delivered to support the future native woodland.')
  ];

  plantingDayImages: TimelineImage[] = [
    this.timelineImage('planting-01', 'Volunteers planting young native trees across the pocket forest site.'),
    this.timelineImage('planting-02', 'Planting teams working along the edge of the prepared plot.'),
    this.timelineImage('planting-03', 'Families and volunteers planting native tree whips together.'),
    this.timelineImage('planting-04', 'Volunteers placing young trees into the prepared soil.'),
    this.timelineImage('planting-05', 'Freshly planted whips with volunteers working in the background.'),
    this.timelineImage('planting-06', 'The pocket forest site after the community planting session.')
  ];

  fencingDayImages: TimelineImage[] = [
    this.timelineImage('fencing-01', 'Volunteers weaving hurdle fencing along the forest edge.'),
    this.timelineImage('fencing-02', 'Hurdle fencing taking shape around the Back Pocket Forest.')
  ];

  fencingCompletedImages: TimelineImage[] = [
    this.timelineImage('fencing-complete-01', 'Completed hurdle fencing encircling the pocket forest.'),
    this.timelineImage('fencing-complete-02', 'Finished fence line with the newly planted woodland behind it.')
  ];

  officialOpeningImages: TimelineImage[] = [
    this.timelineImage('official-opening-01', 'Guests gathered beside the covered Back Pocket Forest lectern before the unveiling.'),
    this.timelineImage('official-opening-02', 'The new Back Pocket Forest information lectern unveiled beside the young woodland.'),
    this.timelineImage('official-opening-03', 'Close-up of the Back Pocket Forest lectern explaining the Miyawaki method and planted species.'),
    this.timelineImage('official-opening-04', 'A time capsule being buried beside the Back Pocket Forest.'),
    this.timelineImage('official-opening-05', 'A volunteer helping bury the Back Pocket Forest time capsule.'),
    this.timelineImage('official-opening-06', 'A supporter standing with a spade after helping with the time capsule ceremony.'),
    this.timelineImage('official-opening-07', 'A councillor helping bury the time capsule at the Back Pocket Forest opening.')
  ];

  activeIndex = 0;
  activeGallery: TimelineImage[] = this.workBeginsImages;
  lightboxOpen = false;

  @ViewChild('lightboxContainer') lightboxContainer?: ElementRef<HTMLElement>;
  @ViewChildren('timelineEntry') timelineEntries?: QueryList<ElementRef<HTMLElement>>;
  private animatedStats = new WeakSet<Element>();

  openLightbox(index: number, gallery: TimelineImage[]): void {
    this.activeGallery = gallery;
    this.activeIndex = index;
    this.lightboxOpen = true;
    setTimeout(() => this.lightboxContainer?.nativeElement.focus(), 0);
  }

  closeLightbox(): void {
    this.lightboxOpen = false;
  }

  nextImage(): void {
    this.activeIndex = (this.activeIndex + 1) % this.activeGallery.length;
  }

  prevImage(): void {
    this.activeIndex = (this.activeIndex - 1 + this.activeGallery.length) % this.activeGallery.length;
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeLightbox();
    }

    if (event.key === 'ArrowRight') {
      this.nextImage();
    }

    if (event.key === 'ArrowLeft') {
      this.prevImage();
    }
  }

  ngAfterViewInit(): void {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const entries = this.timelineEntries?.toArray() ?? [];

    if (prefersReducedMotion || entries.length === 0) {
      entries.forEach((entry) => entry.nativeElement.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (observedEntries) => {
        observedEntries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            this.animateStats(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    entries.forEach((entry) => observer.observe(entry.nativeElement));
  }

  private animateStats(entry: Element): void {
    const statNodes = Array.from(entry.querySelectorAll<HTMLElement>('.timeline__stat-number'));
    if (statNodes.length === 0) {
      return;
    }

    statNodes.forEach((node) => {
      if (this.animatedStats.has(node)) {
        return;
      }

      const target = Number(node.dataset['target'] ?? '0');
      const duration = 900;
      const start = performance.now();
      this.animatedStats.add(node);

      const tick = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const value = Math.round(target * progress);
        node.textContent = value.toString();

        if (progress < 1) {
          requestAnimationFrame(tick);
        }
      };

      requestAnimationFrame(tick);
    });
  }

  private timelineImage(name: string, alt: string): TimelineImage {
    return {
      thumbSrc: `assets/images/miyawaki/optimized/${name}-thumb.webp`,
      lightboxSrc: `assets/images/miyawaki/optimized/${name}-lightbox.webp`,
      fallbackSrc: `assets/images/miyawaki/${name}.jpg`,
      alt
    };
  }
}
