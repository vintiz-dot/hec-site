import os
import glob
import re
import base64

# Base64 encode the logo
logo_path = 'assets/img/logo.png'
with open(logo_path, 'rb') as f:
    base64_data = base64.b64encode(f.read()).decode('utf-8')
    base64_logo = f"data:image/png;base64,{base64_data}"

# 1. Update timetable PDF to use base64 for html2pdf to work properly
timetable_path = 'summer-camp-timetable.html'
with open(timetable_path, 'r', encoding='utf-8') as f:
    tt_content = f.read()

tt_content = tt_content.replace('src="assets/img/logo.png"', f'src="{base64_logo}"')

with open(timetable_path, 'w', encoding='utf-8') as f:
    f.write(tt_content)
print('Updated summer-camp-timetable.html')

# 2. Update courses directory pages
course_files = glob.glob('courses/*.html')
brand_badge_pattern = r'<span class="brand-badge">HEC</span>'
new_logo_tag = '<img src="../assets/img/logo.png" alt="Happy English Club Logo" style="height: 50px; width: auto; object-fit: contain;">'

# Also handle the second span logic in the navbar/footer
old_nav_name = r'<span class="fw-bold" style="font-family:var\(--font-display\)">Happy English Club</span>'
new_nav_name = r'<span class="fw-bold d-none d-sm-inline" style="font-family:var(--font-display)">Happy English Club</span>'

old_footer_name = r'<span class="text-white fw-bold" style="font-family:var\(--font-display\)">Happy English Club</span>'
new_footer_name = r'<span class="text-white fw-bold d-none d-sm-inline" style="font-family:var(--font-display)">Happy English Club</span>'

for fpath in course_files:
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    modified = False
    
    # Replace the brand badge with the logo image path relative to courses/
    if '<span class="brand-badge">HEC</span>' in content:
        content = content.replace('<span class="brand-badge">HEC</span>', new_logo_tag)
        modified = True
        
    if re.search(old_nav_name, content):
        content = re.sub(old_nav_name, new_nav_name, content)
        
    if re.search(old_footer_name, content):
        content = re.sub(old_footer_name, new_footer_name, content)
        
    if modified:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {fpath}")
