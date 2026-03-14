import os
import re

path = r'c:\VoidChat\src\pages\Dashboard.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The error was caused by replacing the start of the section 
# but keeping the old content appended or doubled.
# We want to keep the refactored section (Chat Central) 
# and remove the legacy duplicated Welcome/Feature cards that appeared inside the active rooms section.

# Looking at line 223: <main ...> Welcome ... Feature Cards ... Chat Rooms ...
# The refactored version HAS the ChatRoomModule.
# The BROKEN version has DOUBLE main tags or double content.

# Let's find the second '<main' and the following Welcome block and remove it.
pattern = r'</header>\s+<main[^>]*>\s+/\* Welcome \*/[\s\S]*?<div className="space-y-12">\s+/\* Active Rooms \*/'

# Actually, let's just use the line numbers logic from my view_file to be absolutely sure.
# The new content is likely at the top of main, and the old content is further down.
# Wait, looking at lines 200-247, that IS the header and welcome and feature cards.
# Lines 252-394 is the NEW ChatRoomModule.
# Lines 410-497 is the NEW Active Rooms Grid.
# BUT, looking at the previous replace, I might have left some old code after line 280.
# No, let's just grab the whole file structure mentally.

# I will rewrite the essential return block to be clean.
start_marker = 'return ('
end_marker = '  );'

# We want the return to look like:
# return (
#   <div className="min-h-screen relative overflow-hidden">
#     ... ambient blobs ...
#     <header> ... </header>
#     <main>
#       <Welcome />
#       <FeatureCards />
#       <ChatRoomsContainer>
#         <ChatRoomModule />
#         <ActiveRoomsGrid />
#         <HistorySection />
#       </ChatRoomsContainer>
#     </main>
#     <CreateRoomModal />
#   </div>
# );

# I'll use a more surgical approach: find the part that's duplicated.
# Search for the duplicate 'Active Rooms' section markers if any.

# Actually, the file size is 30k, which is huge for this file. 
# It's definitely doubled up.

with open(path, 'w', encoding='utf-8') as f:
    # I'll rebuild the clean file.
    # I have the content in memory. 
    # I'll strip everything between the first 'return (' and the last ');' 
    # and replace it with a clean version.
    
    # Wait, I have the full view from view_file.
    pass

# Better approach: Just use a script to keep only the FIRST instances of the tags 
# and ensure proper nesting.
