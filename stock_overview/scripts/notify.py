import winsound
import time

def main():
    # 2000Hz 주파수로 2초(2000ms) 동안 비프음 출력 (2회 반복)
    for _ in range(2):
        winsound.Beep(2000, 2000)
        time.sleep(0.5)

if __name__ == "__main__":
    main()
