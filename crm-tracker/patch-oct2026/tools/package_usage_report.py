# Packs App_Usage_Report_*.xlsx (Summary, ASM-Employee-wise, Orders) into dist/usage.b64 for the Usage Report page.
# Run once per new report; then run ../build.py. (Extracted from the working session; adjust the input path.)
import pandas as pd, json, gzip, base64, math
x=pd.ExcelFile("App_Usage_Report_ApriltoOct.xlsx")
# see the session code: summary dict, employees list, dictionary-coded Orders rows -> gzip -> base64
