import os
import re

directories_to_scan = ['.', 'courses']

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # We want to replace <nav ...> ...</nav> with <div id="nav-placeholder"></div>
    # and <footer ...> </footer> with <div id="footer-placeholder"></div>
    
    # We need to make sure we don't accidentally replace too much.
    # regex for <nav ...> ... </nav>
    # Note: re.DOTALL makes '.' match newlines
    
    original_content = content
    
    # Replace Navbar
    # non-greedy match for <nav id="main-nav" ... </nav>
    nav_pattern = r'<nav id="main-nav".*?</nav>'
    content = re.sub(nav_pattern, '<div id="nav-placeholder"></div>', content, flags=re.DOTALL)
    
    # Replace Footer
    footer_pattern = r'<footer class="footer".*?</footer>'
    content = re.sub(footer_pattern, '<div id="footer-placeholder"></div>', content, flags=re.DOTALL)

    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

for d in directories_to_scan:
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.endswith('.html') and not f.endswith('-vn.html'):
                process_file(os.path.join(d, f))

print("Done removing redundancies.")
