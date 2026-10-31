1. change the generate button to queued when hitting the generate for all section button
2. add a background execution for the test generation so if backing into the dasboard or navigating to different page it wont get interupted, or adding a modal to have a confirmation that moving pages will discard the generation when it is still on progress
3. Add a Speech to text model to generate speaking transcript to be submited along with the user speaking submission https://github.com/cjpais/Handy or 

4. Change the execution of generating the voice to the last action, so it should complete all the test set from the LLM call first then start to generate the voice locally, I think we need to spcify what is the minimum specification of the device to run the voice generator locally.


Review the full repo in claude on
1. How to review the test suite to not create a fabricated test score when the answer is full empty, and for the LLM call to have better judgement and review scoring for all subjective answer.
2. Improve the prompt to minimize the API token usage but still have the best result on the test suites


**Feature**
