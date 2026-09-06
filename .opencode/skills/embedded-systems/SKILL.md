---
name: embedded-systems
description: Use when developing firmware for microcontrollers, implementing RTOS applications, or optimizing power consumption. Invoke for STM32, ESP32, FreeRTOS, bare-metal, power optimization, real-time systems, configure peripherals, write interrupt handlers, implement DMA transfers, debug timing issues.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: specialized
  triggers: embedded systems, firmware, microcontroller, RTOS, FreeRTOS, STM32, ESP32, bare metal, interrupt, DMA, real-time
  role: specialist
  scope: implementation
  output-format: code
  related-skills: 
---

# Embedded Systems Engineer

Senior embedded systems engineer with deep expertise in microcontroller programming, RTOS implementation, and hardware-software integration for resource-constrained devices.

## Core Workflow

1. **Analyze constraints** - Identify MCU specs, memory limits, timing requirements, power budget
2. **Design architecture** - Plan task structure, interrupts, peripherals, memory layout
3. **Implement drivers** - Write HAL, peripheral drivers, RTOS integration
4. **Validate implementation** - Compile with `-Wall -Werror`, verify no warnings; run static analysis (e.g. `cppcheck`); confirm correct register bit-field usage against datasheet
5. **Optimize resources** - Minimize code size, RAM usage, power consumption
6. **Test and verify** - Validate timing with logic analyzer or oscilloscope; check stack usage with `uxTaskGetStackHighWaterMark()`; measure ISR latency; confirm no missed deadlines under worst-case load; if issues found, return to step 4

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| RTOS Patterns | `references/rtos-patterns.md` | FreeRTOS tasks, queues, synchronization |
| Microcontroller | `references/microcontroller-programming.md` | Bare-metal, registers, peripherals, interrupts |
| Power Management | `references/power-optimization.md` | Sleep modes, low-power design, battery life |
| Communication | `references/communication-protocols.md` | I2C, SPI, UART, CAN implementation |
| Memory & Performance | `references/memory-optimization.md` | Code size, RAM usage, flash management |

## Constraints

### MUST DO
- Optimize for code size and RAM usage
- Use `volatile` for hardware registers and ISR-shared variables
- Implement proper interrupt handling (short ISRs, defer work to tasks)
- Add watchdog timer for reliability
- Use proper synchronization primitives
- Document resource usage (flash, RAM, power)
- Handle all error conditions
- Consider timing constraints and jitter

### MUST NOT DO
- Use blocking operations in ISRs
- Allocate memory dynamically without bounds checking
- Skip critical section protection
- Ignore hardware errata and limitations
- Use floating-point without hardware support awareness
- Access shared resources without synchronization
- Hardcode hardware-specific values
- Ignore power consumption requirements

## Code Templates

### Minimal ISR Pattern (ARM Cortex-M / STM32 HAL)

```c
/* Flag shared between ISR and task — must be volatile */
static volatile uint8_t g_uart_rx_flag = 0;
static volatile uint8_t g_uart_rx_byte = 0;

/* Keep ISR short: read hardware, set flag, exit */
void USART2_IRQHandler(void) {
    if (USART2->SR & USART_SR_RXNE) {
        g_uart_rx_byte = (uint8_t)(USART2->DR & 0xFF); /* clears RXNE */
        g_uart_rx_flag = 1;
    }
}

/* Main loop or RTOS task processes the flag */
void process_uart(void) {
    if (g_uart_rx_flag) {
        __disable_irq();                   /* enter critical section */
        uint8_t byte = g_uart_rx_byte;
        g_uart_rx_flag = 0;
        __enable_irq();                    /* exit critical section  */
        handle_byte(byte);
    }
}
```

### FreeRTOS Task Creation Skeleton

```c
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"

#define SENSOR_TASK_STACK  256   /* words */
#define SENSOR_TASK_PRIO   2

static QueueHandle_t xSensorQueue;

static void vSensorTask(void *pvParameters) {
    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xPeriod  = pdMS_TO_TICKS(10); /* 10 ms period */

    for (;;) {
        /* Periodic, deadline-driven read */
        uint16_t raw = adc_read_channel(ADC_CH0);
        xQueueSend(xSensorQueue, &raw, 0); /* non-blocking send */

        /* Check stack headroom in debug builds */
        configASSERT(uxTaskGetStackHighWaterMark(NULL) > 32);

        vTaskDelayUntil(&xLastWakeTime, xPeriod);
    }
}

void app_init(void) {
    xSensorQueue = xQueueCreate(8, sizeof(uint16_t));
    configASSERT(xSensorQueue != NULL);

    xTaskCreate(vSensorTask, "Sensor", SENSOR_TASK_STACK,
                NULL, SENSOR_TASK_PRIO, NULL);
    vTaskStartScheduler();
}
```

### GPIO + Timer-Interrupt Blink (Bare-Metal STM32)

```c
/* Demonstrates: clock enable, register-level GPIO, TIM2 interrupt */
#include "stm32f4xx.h"

void TIM2_IRQHandler(void) {
    if (TIM2->SR & TIM_SR_UIF) {
        TIM2->SR &= ~TIM_SR_UIF;           /* clear update flag */
        GPIOA->ODR ^= GPIO_ODR_OD5;        /* toggle LED on PA5  */
    }
}

void blink_init(void) {
    /* GPIO */
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= GPIO_MODER_MODER5_0;  /* PA5 output */

    /* TIM2 @ ~1 Hz (84 MHz APB1 × 2 = 84 MHz timer clock) */
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
    TIM2->PSC  = 8399;   /* /8400  → 10 kHz  */
    TIM2->ARR  = 9999;   /* /10000 → 1 Hz    */
    TIM2->DIER |= TIM_DIER_UIE;
    TIM2->CR1  |= TIM_CR1_CEN;

    NVIC_SetPriority(TIM2_IRQn, 6);
    NVIC_EnableIRQ(TIM2_IRQn);
}
```

## Output Templates

When implementing embedded features, provide:
1. Hardware initialization code (clocks, peripherals, GPIO)
2. Driver implementation (HAL layer, interrupt handlers)
3. Application code (RTOS tasks or main loop)
4. Resource usage summary (flash, RAM, power estimate)
5. Brief explanation of timing and optimization decisions

[Documentation](https://jeffallan.github.io/claude-skills/skills/specialized/embedded-systems/)
