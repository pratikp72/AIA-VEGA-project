/**
 * Hide "Add another entry" button for quiz and feedback_question components
 * in Course edit view since auto-creation logic creates one entry per language.
 */

import { useEffect } from 'react';

const COURSE_MODEL = 'api::course.course';

function HideAddButtonsForQuizFeedback({ slug }) {
  if (slug !== COURSE_MODEL) return null;

  useEffect(() => {
    // Function to hide buttons
    const hideButtons = () => {
      // Find all buttons with "Add an entry" text
      const allButtons = document.querySelectorAll('button');
      
      allButtons.forEach(button => {
        const buttonText = button.textContent || '';
        
        // Check if this is the "Add an entry" button
        if (buttonText.trim() === 'Add an entry' || buttonText.includes('Add an entry')) {
          // Check if it's within quiz or feedback section
          let currentElement = button.parentElement;
          let isQuizOrFeedback = false;
          let depth = 0;
          
          // Traverse up the DOM tree
          while (currentElement && depth < 15) {
            // Check all previous siblings at this level
            let sibling = currentElement.previousElementSibling;
            while (sibling) {
              const siblingText = sibling.textContent || '';
              const siblingHTML = sibling.innerHTML || '';
              
              // Check if sibling contains quiz or feedback entries
              if (
                siblingText.includes('quiz-') || 
                siblingText.includes('fb-') ||
                siblingHTML.includes('quiz-') || 
                siblingHTML.includes('fb-')
              ) {
                isQuizOrFeedback = true;
                break;
              }
              
              sibling = sibling.previousElementSibling;
            }
            
            if (isQuizOrFeedback) break;
            
            // Also check the parent's attributes and content
            const parentHTML = currentElement.outerHTML || '';
            const parentText = currentElement.textContent || '';
            
            // Look for section headers like "quiz (2)" or "feedback_question (2)"
            if (parentHTML.includes('quiz (') || parentHTML.includes('feedback_question (')) {
              isQuizOrFeedback = true;
              break;
            }
            
            // Check if there's a label or heading with quiz/feedback
            const labels = currentElement.querySelectorAll('label, h1, h2, h3, h4, h5, h6, span');
            for (const label of labels) {
              const labelText = label.textContent || '';
              if (labelText.startsWith('quiz (') || labelText.startsWith('feedback_question (')) {
                isQuizOrFeedback = true;
                break;
              }
            }
            
            if (isQuizOrFeedback) break;
            
            currentElement = currentElement.parentElement;
            depth++;
          }
          
          if (isQuizOrFeedback) {
            // Hide the button completely
            button.style.cssText = 'display: none !important; visibility: hidden !important; height: 0 !important; width: 0 !important; margin: 0 !important; padding: 0 !important; position: absolute !important; pointer-events: none !important; opacity: 0 !important;';
            button.disabled = true;
            button.setAttribute('aria-hidden', 'true');
            button.setAttribute('tabindex', '-1');
          }
        }
      });
    };

    // Run immediately
    hideButtons();

    // Run after delays to catch dynamically loaded buttons
    const timeout1 = setTimeout(hideButtons, 50);
    const timeout2 = setTimeout(hideButtons, 200);
    const timeout3 = setTimeout(hideButtons, 500);
    const timeout4 = setTimeout(hideButtons, 1000);
    const timeout5 = setTimeout(hideButtons, 2000);

    // Use MutationObserver to catch newly added buttons
    const observer = new MutationObserver(() => {
      hideButtons();
    });

    // Observe the entire document for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Also listen for clicks and route changes
    const handleClick = () => {
      setTimeout(hideButtons, 50);
      setTimeout(hideButtons, 200);
    };
    
    document.addEventListener('click', handleClick);

    // Cleanup
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      clearTimeout(timeout3);
      clearTimeout(timeout4);
      clearTimeout(timeout5);
      observer.disconnect();
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return null;
}

export default HideAddButtonsForQuizFeedback;
