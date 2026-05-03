import re
import os

files_to_fix_base64 = ['summer-camp-timetable.html', 'summer-camp-timetable-g12.html']

for f in files_to_fix_base64:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Replace base64 image
        content = re.sub(r'src="data:image/png;base64,[^"]+"', 'src="assets/img/logo.png"', content)
        
        # Replace morning break text
        content = content.replace('data-en="Break" data-vi="Giải lao">\n                        Break', 
                                  'data-en="Break &amp; Afternoon Snack" data-vi="Giải lao và bữa quà chiều">\n                        Break &amp; Afternoon Snack')
        # Just in case the whitespace is slightly different
        content = content.replace('data-en="Break" data-vi="Giải lao">', 'data-en="Break &amp; Afternoon Snack" data-vi="Giải lao và bữa quà chiều">')
        content = re.sub(r'data-vi="Giải lao và bữa quà chiều">\s*Break\s*</td>', 'data-vi="Giải lao và bữa quà chiều">\n                        Break &amp; Afternoon Snack\n                    </td>', content)

        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)

# Fix make_g12.py
if os.path.exists('make_g12.py'):
    with open('make_g12.py', 'r', encoding='utf-8') as file:
        content = file.read()
    content = content.replace('data-en="Break" data-vi="Giải lao">', 'data-en="Break &amp; Afternoon Snack" data-vi="Giải lao và bữa quà chiều">')
    content = re.sub(r'data-vi="Giải lao và bữa quà chiều">\s*Break\s*</td>', 'data-vi="Giải lao và bữa quà chiều">\n                        Break &amp; Afternoon Snack\n                    </td>', content)
    with open('make_g12.py', 'w', encoding='utf-8') as file:
        file.write(content)

# Fix hec-bilingual-timetable.html
if os.path.exists('hec-bilingual-timetable.html'):
    with open('hec-bilingual-timetable.html', 'r', encoding='utf-8') as file:
        content = file.read()
    content = content.replace('<td colspan="5" class="break">Break <br><span class="v-text">Giải lao</span></td>', 
                              '<td colspan="5" class="break">Break &amp; Afternoon Snack <br><span class="v-text">Giải lao và bữa quà chiều</span></td>')
    with open('hec-bilingual-timetable.html', 'w', encoding='utf-8') as file:
        file.write(content)

print("Fixes applied successfully.")
