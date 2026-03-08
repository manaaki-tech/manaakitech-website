// Component Loader for ManaakiTech Landing Page
class ComponentLoader {
  constructor() {
    this.loadedComponents = 0;
    this.totalComponents = 0;
    this.criticalComponentsLoaded = false;
    this.criticalComponents = ['header', 'hero'];
    this.loadingPriority = {
      'header': 1,
      'hero': 2,
      'features': 3,
      'benefits': 4,
      // 'pricing': 5,
      'contact': 6,
      'footer': 7
    };
  }

  // Create a full-page loading overlay
  createLoadingOverlay() {
    // Check if any critical components exist on this page
    const hasCriticalComponents = this.criticalComponents.some(componentName => {
      return document.querySelector(`[data-component="${componentName}"]`) !== null;
    });
    
    // If no critical components are found, don't show the loading screen
    if (!hasCriticalComponents) {
      document.body.style.visibility = 'visible';
      return;
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'page-loading-overlay';
    overlay.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden'; // Prevent scrolling while loading
    
    // Set a maximum timeout for the loading screen (3 seconds)
    setTimeout(() => {
      this.removeLoadingOverlay();
    }, 3000);
  }
  
  // Remove the loading overlay when critical components are loaded
  removeLoadingOverlay() {
    const overlay = document.getElementById('page-loading-overlay');
    if (overlay) {
      // Make the body visible before starting the fade-out
      document.body.style.visibility = 'visible';
      
      overlay.classList.add('fade-out');
      setTimeout(() => {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        document.body.style.overflow = ''; // Restore scrolling
      }, 500); // Match the fade-out animation duration
    } else {
      // If there's no overlay but the body is still hidden, make it visible
      document.body.style.visibility = 'visible';
      document.body.style.overflow = '';
    }
  }
  
  // Check if all critical components are loaded
  checkCriticalComponentsLoaded(componentName) {
    if (this.criticalComponents.includes(componentName)) {
      const allCriticalLoaded = this.criticalComponents.every(name => {
        const element = document.querySelector(`[data-component="${name}"]`);
        return element && element.classList.contains('component-loaded');
      });
      
      if (allCriticalLoaded && !this.criticalComponentsLoaded) {
        this.criticalComponentsLoaded = true;
        this.removeLoadingOverlay();
      }
    }
  }

  async loadComponent(elementId, componentKey) {
    this.totalComponents++;
    try {
      // Fetch the component HTML from the components directory
      const response = await fetch(`components/${componentKey}.html`);
      if (!response.ok) {
        throw new Error(`Failed to load component: ${componentKey}`);
      }
      
      const html = await response.text();
      const element = document.getElementById(elementId);
      
      element.innerHTML = html;
      element.classList.add('component-loaded');
      
      // Check if this was a critical component
      this.checkCriticalComponentsLoaded(componentKey);
      
      this.loadedComponents++;
      
      if (this.loadedComponents === this.totalComponents) {
        // All components loaded, initialize any scripts
        this.initializeScripts();
      }
    } catch (error) {
      console.error('Error loading component:', error);
    }
  }

  initializeScripts() {
    // Re-initialize any scripts that need to run after components are loaded
    document.dispatchEvent(new Event('componentsLoaded'));

    // Scroll to hash anchor if present (handles cross-page links like /product.html#contact)
    if (window.location.hash) {
      const target = document.querySelector(window.location.hash);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }
}

// Create a global instance
window.componentLoader = new ComponentLoader();

// Initialize components when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Create the loading overlay before anything else
  window.componentLoader.createLoadingOverlay();
  
  // Get all components with 'data-component' attribute
  const componentElements = document.querySelectorAll('[data-component]');
  
  // Convert to array and sort by priority
  const sortedComponents = Array.from(componentElements).sort((a, b) => {
    const aName = a.getAttribute('data-component');
    const bName = b.getAttribute('data-component');
    const aPriority = window.componentLoader.loadingPriority[aName] || 999;
    const bPriority = window.componentLoader.loadingPriority[bName] || 999;
    return aPriority - bPriority;
  });
  
  // Body is already hidden via inline style
  
  // Load components in priority order
  sortedComponents.forEach(element => {
    const componentName = element.getAttribute('data-component');
    const elementId = element.id;
    if (componentName && elementId) {
      window.componentLoader.loadComponent(elementId, componentName);
    }
  });
});

// Add CSS for loading overlay
const style = document.createElement('style');
style.textContent = `
  #page-loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: #ffffff;
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: opacity 0.5s ease;
  }
  
  #page-loading-overlay.fade-out {
    opacity: 0;
  }
  
  .loading-container {
    text-align: center;
  }
  
  .loading-spinner {
    width: 50px;
    height: 50px;
    border: 4px solid rgba(2, 132, 199, 0.1);
    border-radius: 50%;
    border-top: 4px solid #a84536;
    animation: spin 1s linear infinite;
    margin: 0 auto;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  .component-loaded {
    animation: fadeIn 0.3s ease-out;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;
document.head.appendChild(style);
