# Manaaki Tech Landing Page

A modern, responsive company landing page for **Manaaki Tech** - empowering social services with culturally responsive technology solutions.

![Manaaki Tech Hero](images/iStock-1486791544.jpg)

## 🎯 Project Overview

This is a company-focused landing page that showcases Manaaki Tech's mission to empower social service providers worldwide with culturally responsive technology. The site features a warm, community-centered design with a focus on accessibility and professional presentation.

### Key Features

- **Company-Focused Branding**: Positions Manaaki Tech as a trusted technology company
- **Community-Centered Design**: Warm orange color scheme with community imagery
- **Responsive Layout**: Optimized for mobile, tablet, and desktop viewing
- **Accessibility Compliant**: WCAG AA standards with proper contrast ratios
- **Component-Based Architecture**: Modular HTML components for easy maintenance
- **Performance Optimized**: Lazy loading for images and optimized assets

## 🚀 Getting Started

### Prerequisites

- Python 3.x (for local development server)
- Modern web browser
- Text editor or IDE

### Local Development

1. **Clone or download the project**
   ```bash
   cd manaakitech-website
   ```

2. **Start the development server**
   ```bash
   python test_server.py
   ```
   
   Or use an alternative port:
   ```bash
   python test_server.py 3000
   ```

3. **Open in browser**
   The server will automatically open `http://localhost:8000` in your browser.

### File Structure

```
manaakitech-website/
├── index.html                 # Main landing page
├── support.html              # Support center page
├── privacy-policy.html       # Privacy policy
├── thank-you.html           # Thank you page
├── tile-generator.html      # Utility page
├── test_server.py           # Local development server
├── components/              # Reusable HTML components
│   ├── header.html
│   ├── hero.html
│   ├── features.html
│   ├── benefits.html
│   ├── contact.html
│   └── footer.html
├── css/
│   └── styles.css           # Custom CSS styles
├── js/
│   ├── componentLoader.js   # Dynamic component loading
│   ├── main.js             # Main JavaScript functionality
│   └── lazy-load.js        # Image lazy loading
├── images/                  # Image assets
└── svg/                     # SVG icons and graphics
```

## 🎨 Design System

### Color Palette

The site uses a warm orange color scheme that reflects community values:

```css
Primary Orange Scale:
- primary-50:  #fff7ed   /* Very light orange */
- primary-100: #ffedd5   /* Light orange */
- primary-200: #fed7aa   /* Lighter orange */
- primary-300: #fdba74   /* Light-medium orange */
- primary-400: #fb923c   /* Medium orange */
- primary-500: #f97316   /* Primary orange */
- primary-600: #ea580c   /* Primary-dark orange */
- primary-700: #c2410c   /* Dark orange */
- primary-800: #9a3412   /* Darker orange */
- primary-900: #7c2d12   /* Very dark orange */
```

### Typography

- **Headings**: Bold, hierarchical sizing for clear information architecture
- **Body Text**: Readable font sizes with proper line spacing
- **Accessibility**: High contrast ratios and scalable text

### Components

- **Hero Section**: Full-width with community background image and overlay
- **Features Grid**: Card-based layout showcasing company values
- **About Section**: Company information with mission statement
- **Contact Forms**: Accessible form design with validation
- **Footer**: Consistent navigation and company information

## 🛠 Technologies Used

- **HTML5**: Semantic markup structure
- **Tailwind CSS**: Utility-first CSS framework via CDN
- **Alpine.js**: Lightweight JavaScript framework for interactivity
- **Vanilla JavaScript**: Custom functionality and component loading
- **Python**: Local development server (test_server.py)

## 📱 Responsive Design

The site is fully responsive with breakpoints:

- **Mobile**: 320px - 767px
- **Tablet**: 768px - 1023px  
- **Desktop**: 1024px+
- **Large Desktop**: 1280px+

## ♿ Accessibility Features

- **WCAG AA Compliant**: Color contrast ratios meet accessibility standards
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: Proper ARIA labels and semantic markup
- **Focus States**: Clear visual focus indicators
- **Alt Text**: Descriptive alt text for all images

## 🔧 Customization

### Updating Colors

Colors are configured in the Tailwind config within each HTML file:

```javascript
tailwind.config = {
    theme: {
        extend: {
            colors: {
                primary: {
                    // Update these values to change the color scheme
                    500: '#f97316', // Primary orange
                    600: '#ea580c', // Primary-dark orange
                    700: '#c2410c', // Dark orange
                    // ... etc
                }
            }
        }
    }
}
```

### Adding New Components

1. Create a new HTML file in the `components/` directory
2. Add the component to `componentLoader.js`
3. Include it in your page with: `<div data-component="your-component"></div>`

### Updating Content

- **Company Information**: Edit the hero, about, and footer components
- **Features**: Update `components/features.html`
- **Contact Information**: Modify `components/contact.html`

## 🚀 Deployment

### Automatic Deployment (Recommended)

**Live Site**: [https://bejewelled-gecko-85feaf.netlify.app/](https://bejewelled-gecko-85feaf.netlify.app/)

This project is configured for automatic deployment:
- **Push to GitHub** → **Automatic deployment to Netlify**
- Any changes pushed to the main branch will automatically trigger a new deployment
- Deployment typically completes within 1-2 minutes

### Alternative Static Hosting

This site can also be deployed to other static hosting services:

- **Netlify**: Drag and drop the project folder (manual deployment)
- **Vercel**: Connect your Git repository
- **GitHub Pages**: Push to a GitHub repository
- **AWS S3**: Upload files to an S3 bucket

### Production Checklist

- [ ] Optimize images (compress large images)
- [ ] Test all contact forms
- [ ] Verify all links work
- [ ] Run accessibility audit
- [ ] Test on multiple devices/browsers
- [ ] Set up analytics (if needed)

## 📄 Pages Overview

### Main Landing Page (`index.html`)
- Hero section with community imagery
- Company overview and mission
- Feature highlights
- About section
- Contact information

### Support Center (`support.html`)
- Help documentation
- Contact information for support
- Resource links

### Privacy Policy (`privacy-policy.html`)
- Data protection information
- Privacy practices
- User rights

### Thank You Page (`thank-you.html`)
- Form submission confirmation
- Next steps for users

## 🤝 Contributing

To contribute to this project:

1. Make your changes
2. Test thoroughly across devices
3. Ensure accessibility compliance
4. Update documentation if needed

## 📞 Support

For questions or support regarding this landing page:

- **Company**: Manaaki Tech
- **Website**: [Your website URL]
- **Email**: [Your contact email]

## 📄 License

© 2025 Manaaki Tech. All rights reserved.

---

*Built with ❤️ for social service providers worldwide*