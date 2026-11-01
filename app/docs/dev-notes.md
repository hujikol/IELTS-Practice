1. change the generate button to queued when hitting the generate for all section button
2. add a background execution for the test generation so if backing into the dasboard or navigating to different page it wont get interupted, or adding a modal to have a confirmation that moving pages will discard the generation when it is still on progress
3. Add a Speech to text model to generate speaking transcript to be submited along with the user speaking submission https://github.com/cjpais/Handy or 

4. Change the execution of generating the voice to the last action, so it should complete all the test set from the LLM call first then start to generate the voice locally, I think we need to spcify what is the minimum specification of the device to run the voice generator locally.
5. Refactor the scoring for listening and writing, it still have some fabricated and uncontrolled scoring, some bad repeatable writing scored differently

6.optimize the web so that when generating the voice the full web or pc is not freezing on the device that have 8gb< less ram, into 32bit high quality kokoro model. then make the kokoriew the test suie default model, remove the othete to not create a fabri ocption to clear the cache of ganted te toice and saved model score when the answer is full empty, and for the LLM call to have better judgement and review scoring for all subjective answer.
7. The listening section is still confusing when the text is a 2 way narrator voice, it should differentiate the instructor voices and the real speaker voice, then there will be 3 different voice for a two way listening section. And the voice narrating the story sometimes jumbled, the voice is narrating a part of the other voice so it can be confusing for the listener wheter this is the context for the first voice or still following the context of the second voice
8. the speaking test section still not showing in the review page, it should be a tab for it with voice recording and the transcribtion of it then a suggestion of it like in the writing section

2. Improve the prompt to minimize the API token usage but still have the best result on the test suites


**Feature**
