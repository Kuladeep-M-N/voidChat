import os

path = r'c:\VoidChat\src\pages\Dashboard.tsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Reconstruct the file by merging the correct segments.
# Lines 1-250 are good (Imports, Interface, Logic, Header, Start of Main, Welcome, Features)
# Lines 251-497 are the NEW refactored active rooms and grid logic.
# Lines 498-545 are the NEW refactored history section (which was part of the refactor).
# The problem is that line 546-547 are </section> </div> </main>
# and then it starts AGAIN with <main> which is the duplicated OLD code.

# Let's keep up to line 547 (which is the first closing </main>)
# and then skip until we find the AnimatePresence for the modal (line 550).

output_lines = lines[:547] # Keep up to the first closing </main>
output_lines.append("\n")

# Find the start of the modal (AnimatePresence showCreate)
modal_index = -1
for i in range(547, len(lines)):
    if '<AnimatePresence>' in lines[i] and 'showCreate' in lines[i+1]:
        modal_index = i
        break

if modal_index != -1:
    output_lines.extend(lines[modal_index:])
else:
    # Backup plan if exact match fails
    for i in range(len(lines)-1, 547, -1):
        if 'showCreate' in lines[i]:
            modal_index = i - 1
            break
    if modal_index != -1:
        output_lines.extend(lines[modal_index:])

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(output_lines)

print(f"Repaired file. Final line count: {len(output_lines)}")
