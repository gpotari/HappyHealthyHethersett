import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';

type GalleryImage = {
  src: string;
  alt: string;
  caption: string;
};

@Component({
  selector: 'app-pocket-forest-gallery',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pocket-forest-gallery.component.html',
  styleUrls: ['./pocket-forest-gallery.component.css']
})
export class PocketForestGalleryComponent {
  images: GalleryImage[] = [
    {
      src: 'assets/images/gallery/Miyawaki/Miyawaki0.jpg',
      alt: 'Marked out pocket forest plot beside Hethersett Village Hall tennis courts.',
      caption: 'Village Hall field sectioned off ready for the 120 square metre forest site.'
    },
    {
      src: 'assets/images/gallery/Miyawaki/Miyawaki1.jpg',
      alt: 'Excavator bucket cutting turf at the pocket forest site.',
      caption: 'Topsoil carefully lifted to aerate the ground before planting.'
    },
    {
      src: 'assets/images/gallery/Miyawaki/Miyawaki2.jpg',
      alt: 'Compost pile ready to nourish new pocket forest trees.',
      caption: 'Rich compost delivered to feed the young native tree whips.'
    },
    {
      src: 'assets/images/gallery/Miyawaki/Miyawaki3.jpg',
      alt: 'Excavator shaping planting pits across the grass field.',
      caption: 'Volunteers and contractors shaping planting pits for dense clusters.'
    },
    {
      src: 'assets/images/gallery/Miyawaki/Miyawaki4.jpg',
      alt: 'Excavator and compost mounds awaiting tree planting.',
      caption: 'Groundworks complete and soil mounded, ready for 600 native trees in November.'
    }
  ];

  activeIndex = 0;
  lightboxOpen = false;

  @ViewChild('lightboxContainer') lightboxContainer?: ElementRef<HTMLElement>;

  openLightbox(index: number): void {
    this.activeIndex = index;
    this.lightboxOpen = true;
    setTimeout(() => this.lightboxContainer?.nativeElement.focus(), 0);
  }

  closeLightbox(): void {
    this.lightboxOpen = false;
  }

  nextImage(): void {
    this.activeIndex = (this.activeIndex + 1) % this.images.length;
  }

  prevImage(): void {
    this.activeIndex = (this.activeIndex - 1 + this.images.length) % this.images.length;
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
}
