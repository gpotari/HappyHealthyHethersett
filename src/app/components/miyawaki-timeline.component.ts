import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, QueryList, ViewChild, ViewChildren } from '@angular/core';

type TimelineImage = {
  src: string;
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
    {
      src: 'assets/images/miyawaki/work-begins-01.jpg',
      alt: 'Excavator preparing soil beside the tennis courts.'
    },
    {
      src: 'assets/images/miyawaki/work-begins-02.jpg',
      alt: 'Cleared grass plot with temporary fencing and materials.'
    },
    {
      src: 'assets/images/miyawaki/work-begins-03.jpg',
      alt: 'Fresh compost and woodchip delivered for soil improvement.'
    },
    {
      src: 'assets/images/miyawaki/work-begins-04.jpg',
      alt: 'Leveled soil plot ready for planting.'
    },
    {
      src: 'assets/images/miyawaki/work-begins-05.jpg',
      alt: 'Excavator bucket cutting into the turf during preparation.'
    }
  ];

  plantingDayImages: TimelineImage[] = [
    {
      src: 'assets/images/miyawaki/planting-01.jpg',
      alt: 'Volunteers planting young trees across the site.'
    },
    {
      src: 'assets/images/miyawaki/planting-02.jpg',
      alt: 'Planting teams working along the edge of the plot.'
    },
    {
      src: 'assets/images/miyawaki/planting-03.jpg',
      alt: 'Families and volunteers planting across the site.'
    },
    {
      src: 'assets/images/miyawaki/planting-04.jpg',
      alt: 'Volunteers planting near the hurdle fencing.'
    },
    {
      src: 'assets/images/miyawaki/planting-05.jpg',
      alt: 'Freshly planted whips with volunteers in the background.'
    }
  ];

  fencingDayImages: TimelineImage[] = [
    {
      src: 'assets/images/miyawaki/fencing-01.jpg',
      alt: 'Volunteers weaving hurdle fencing along the forest edge.'
    },
    {
      src: 'assets/images/miyawaki/fencing-02.jpg',
      alt: 'Hurdle fencing taking shape around the Back Pocket Forest.'
    }
  ];

  fencingCompletedImages: TimelineImage[] = [
    {
      src: 'assets/images/miyawaki/fencing-complete-01.jpg',
      alt: 'Completed hurdle fencing encircling the pocket forest.'
    },
    {
      src: 'assets/images/miyawaki/fencing-complete-02.jpg',
      alt: 'Finished fence line with the newly planted woodland behind it.'
    }
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
}
