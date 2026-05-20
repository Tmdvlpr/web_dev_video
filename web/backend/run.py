"""
CorpMeet Backend Launcher
Выберите режим запуска: dev (порт 8001, hot-reload) или prod (порт 8000).
"""
import sys
import uvicorn


DEV_PORT = 8001
PROD_PORT = 8000


def main():
    print()
    print("  ╔═══════════════════════════════╗")
    print("  ║     CorpMeet Backend           ║")
    print("  ╠═══════════════════════════════╣")
    print(f"  ║  1) Dev   (порт {DEV_PORT}, reload)   ║")
    print(f"  ║  2) Prod  (порт {PROD_PORT})           ║")
    print("  ╚═══════════════════════════════╝")
    print()

    choice = input("  Выберите режим [1/2]: ").strip()

    if choice == "2":
        port = PROD_PORT
        reload = False
        print(f"\n  → Запуск PROD на порту {port}...\n")
    else:
        port = DEV_PORT
        reload = True
        print(f"\n  → Запуск DEV на порту {port} (hot-reload)...\n")

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    main()
